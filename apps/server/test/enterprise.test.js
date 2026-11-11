import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './gateway.test.js';
import { createDatabase, createVault } from '../src/database.js';

test('refresh credential renews expired access; replay and disabled sessions are rejected', async t => {
  const f = await fixture(t); const user = await f.create();
  const login = (await f.request('/auth/login','POST',{username:'alice',password:'user-password',device:'test-pc'})).body;
  f.db.transaction(s => { s.tokens.find(t => t.user_id === user.id).expires_at = '2000-01-01'; });
  assert.equal((await f.chat(login.token)).status,401);
  const renewed = await f.request('/auth/refresh','POST',{refreshToken:login.refreshToken});
  assert.equal(renewed.status,200); assert.equal((await f.chat(renewed.body.token)).status,200);
  assert.equal((await f.request('/auth/refresh','POST',{refreshToken:login.refreshToken})).status,401);
  await f.request(`/admin/users/${user.id}/status`,'PATCH',{isActive:false},f.admin);
  assert.equal((await f.request('/auth/refresh','POST',{refreshToken:renewed.body.refreshToken})).status,401);
});

test('only ordinary users can be created and account roles remain fixed', async t => {
  const f = await fixture(t); const user = await f.create();
  assert.equal(user.role,'user');
  assert.equal((await f.request('/admin/users/1/password','POST',{password:'reset-password'},f.admin)).status,403);
  assert.equal((await f.request('/admin/users/'+user.id+'/password','POST',{password:'reset-password'},f.admin)).status,200);
  const tokenAfterReset=await f.request('/auth/login','POST',{username:'alice',password:'reset-password'});assert.equal(tokenAfterReset.status,200);
  assert.equal((await f.request('/admin/users','GET',undefined,tokenAfterReset.body.token)).status,403);
  for(const role of ['admin','demo','operator','auditor','constructor']) {
    assert.equal((await f.request('/admin/users','POST',{username:'blocked',password:'other-password',role},f.admin)).status,403);
    assert.equal((await f.request('/admin/users/'+user.id,'PATCH',{role},f.admin)).status,403);
  }
  assert.equal((await f.request('/admin/users/1','PATCH',{role:'user'},f.admin)).body.error.code,'ROLE_FIXED');
  assert.equal((await f.request('/admin/users/1/status','PATCH',{isActive:false},f.admin)).status,400);
  assert.equal((await f.request('/admin/users/1','DELETE',undefined,f.admin)).status,400);
  assert.equal((await f.request('/admin/users/'+user.id,'PATCH',{role:'user',sessionLimit:2},f.admin)).status,200);
});

test('skills publish to all users, update by revision and reject unsafe paths', async t => {
  const f = await fixture(t);
  await f.create('alice'); await f.create('bob');
  const alice = await f.login('alice'), bob = await f.login('bob');
  const data = {name:'team-review',description:'Review code carefully',content:'Check tests and explain risks.',files:{'references/rules.md':'Use small changes.'}};
  const skill = (await f.request('/admin/skills','POST',data,f.admin)).body;
  for (const [route,method] of [['/admin/skills','POST'],[`/admin/skills/${skill.id}`,'PUT']]) {
    const result = await f.request(route,method,{...data,name:'qcode-knowledge'},f.admin);
    assert.equal(result.status,400);
    assert.equal(result.body.error.code,'SKILL_NAME_RESERVED');
  }
  assert.equal(f.db.read().skills.find(item=>item.id===skill.id).name,data.name);
  assert.deepEqual((await f.request('/client/skills','GET',undefined,alice)).body.skills.map(item=>item.name).sort(),['qcode-knowledge','team-review']);
  assert.deepEqual((await f.request('/client/skills','GET',undefined,bob)).body.skills.map(item=>item.name).sort(),['qcode-knowledge','team-review']);
  assert.equal((await f.request('/admin/skills','POST',{...data,name:'bad',files:{'../escape.md':'bad'}},f.admin)).status,400);
  assert.equal((await f.request('/admin/skills','POST',{...data,name:'bad',files:{'CON.txt':'bad'}},f.admin)).status,400);
  const updated = await f.request(`/admin/skills/${skill.id}`,'PUT',{...data,content:'New rules.',active:false},f.admin);
  assert.notEqual(updated.body.revision,skill.revision);
  assert.deepEqual((await f.request('/client/skills','GET',undefined,alice)).body.skills.map(item=>item.name),['qcode-knowledge']);
});

test('only administrators can manage GitHub plugin availability', async t => {
  const f = await fixture(t);
  await f.create();
  const user = await f.login();
  const config = () => f.request('/client/config','GET',undefined,user);
  const update = (enabled, token) => f.request('/admin/plugins/github','POST',{enabled},token);
  assert.equal((await config()).body.githubPluginEnabled,false);
  assert.equal((await update(true,user)).status,403);
  assert.equal((await update('true',f.admin)).status,400);
  assert.equal((await update(true,f.admin)).status,200);
  assert.equal((await config()).body.githubPluginEnabled,true);
  assert.equal((await update(false,f.admin)).status,200);
  assert.equal((await config()).body.githubPluginEnabled,false);
  assert.equal(f.db.read().audits.some(entry => entry.action === 'plugin.update'),false);
});

test('product settings propagate without changing model configuration', async t => {
  const f = await fixture(t);
  const sources = structuredClone(f.db.read().settings.modelSources);
  const updated = await f.request('/admin/settings','PUT',{productName:'团队_<工作台'},f.admin);
  assert.equal(updated.status,200);
  assert.equal(updated.body.productName,'团队_<工作台');
  assert.deepEqual(Object.keys(updated.body).sort(),['productName','minimumClientVersion','maxActiveRequests','auditRetentionDays'].sort());
  assert.deepEqual(f.db.read().settings.modelSources,sources);
  await f.create();
  const config = await f.request('/client/config','GET',undefined,await f.login());
  assert.equal(config.body.productName,'团队_<工作台');
  for(const name of ['', 'a'.repeat(33), 'A\nB', 'A\u001bB'])assert.equal((await f.request('/admin/settings','PUT',{productName:name},f.admin)).status,400);
});

test('disabling user aborts active upstream request and records cancellation', async t => {
  const f = await fixture(t,{timeoutMs:10000}), user = await f.create(), token = await f.login();
  const waiting = f.chat(token,{testCase:'timeout'});
  for(let i=0;i<50 && !f.db.read().requests.length;i++) await new Promise(r=>setTimeout(r,10));
  await f.request(`/admin/users/${user.id}/status`,'PATCH',{isActive:false},f.admin);
  const result = await waiting; assert.equal(result.body.error.code,'USER_DISABLED');
  assert.equal(f.db.read().requests[0].status,'cancelled');
});

test('model prices are captured per request and currencies remain separate', async t => {
  const f = await fixture(t); await f.create(); const token = await f.login(), model = f.db.read().models[0];
  await f.request(`/admin/models/${model.id}`,'PUT',{name:'Priced model',publicName:model.public_name,baseUrl:model.base_url,upstreamModel:model.upstream_model,isDefault:true,inputPrice:2,outputPrice:8,currency:'USD'},f.admin);
  await f.chat(token);
  assert.equal(f.db.read().requests[0].cost_micros,22);
  assert.equal((await f.request('/admin/usage','GET',undefined,f.admin)).body.totals.costs.USD,0.000022);
});

test('SQLite commits atomically, survives reopen and encrypts secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'qcode-sqlite-')), filename = path.join(dir,'gateway.sqlite');
  const vault = createVault('a'.repeat(64));
  let db;
  try {
    db = createDatabase(filename,{vault});
    db.transaction(s => { s.users.push({id:1,username:'alice',role:'user'}); s.nextUserId=2; s.keys.push({id:'k',secret:vault.encrypt('hidden-provider-secret')}); });
    assert.throws(()=>db.transaction(s => s.users.push({id:2,username:'ALICE'})));
    assert.equal(db.read().users.length,1);
    assert.throws(()=>createDatabase(filename,{vault}),/locked/);
    db.close(); db=createDatabase(filename,{vault});
    assert.equal(db.read().users[0].username,'alice'); assert.equal(vault.decrypt(db.read().keys[0].secret),'hidden-provider-secret');
    assert.equal(fs.readFileSync(filename).includes(Buffer.from('hidden-provider-secret')),false);
  } finally { db?.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('old SQLite schemas are rejected without modifying the file', async () => {
  const {DatabaseSync} = await import('node:sqlite');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-old-schema-')),filename=path.join(directory,'old.sqlite');
  try {
    const sql=new DatabaseSync(filename);sql.exec(`CREATE TABLE original(value TEXT); INSERT INTO original VALUES ('keep'); PRAGMA user_version=3;`);sql.close();
    const original=fs.readFileSync(filename);
    assert.throws(()=>createDatabase(filename),/Unsupported database version/);
    assert.deepEqual(fs.readFileSync(filename),original);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
