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

test('roles constrain both UI data access and direct write endpoints', async t => {
  const f = await fixture(t);
  await f.create('operator',{role:'operator'}); const operator = await f.login('operator');
  await f.create('auditor',{role:'auditor'}); const auditor = await f.login('auditor');
  assert.equal((await f.request('/admin/users','GET',undefined,operator)).status,200);
  assert.equal((await f.request('/admin/keys','GET',undefined,operator)).status,403);
  assert.equal((await f.request('/admin/users/1/password','POST',{password:'hijack-password'},operator)).status,403);
  assert.equal((await f.request('/admin/users','POST',{username:'other',password:'other-password',role:'admin'},operator)).status,403);
  assert.equal((await f.request('/admin/users/import','POST',{users:[{username:'bad',password:'other-password',role:'admin'}]},operator)).status,403);
  assert.equal((await f.request('/admin/users','POST',{username:'staff',password:'other-password'},operator)).status,201);
  assert.equal((await f.request('/admin/usage','GET',undefined,auditor)).status,200);
  assert.equal((await f.request('/admin/users','POST',{username:'staff2',password:'other-password'},auditor)).status,403);
  assert.equal((await f.request('/admin/users/1','PATCH',{role:'user'},f.admin)).body.error.code,'LAST_ADMIN');
  assert.equal((await f.request('/admin/users','POST',{username:'prototype',password:'other-password',role:'constructor'},f.admin)).status,403);
});

test('department model/key inheritance and shared quota are enforced across users', async t => {
  const f = await fixture(t);
  const department = (await f.request('/admin/departments','POST',{name:'Engineering',keyId:f.key.id,quotas:{totalRequests:1},userQuotas:{monthlyTokens:100000}},f.admin)).body;
  const alice = await f.create('alice',{departmentId:department.id,keyId:null,quotaMode:'department'});
  await f.create('bob',{departmentId:department.id,keyId:null,quotaMode:'department'});
  const tokens = await Promise.all([f.login('alice'),f.login('bob')]);
  const results = await Promise.all(tokens.map(token => f.chat(token,{testCase:'slow'})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);
  assert.equal(f.db.read().requests[0].department_id,department.id);
  assert.equal((await f.request('/auth/me','GET',undefined,tokens[0])).body.effective_quotas.monthlyTokens,100000);
  await f.request(`/admin/departments/${department.id}/reset-quota`,'POST',{},f.admin);
  assert.equal((await f.chat(tokens[1])).status,200);
  assert.equal((await f.request(`/admin/keys/${f.key.id}`,'DELETE',undefined,f.admin)).status,409);
  assert.equal((await f.request(`/admin/departments/${department.id}`,'DELETE',undefined,f.admin)).status,409);
  await f.request(`/admin/departments/${department.id}`,'PUT',{name:'Engineering',active:false,quotas:{},userQuotas:{}},f.admin);
  assert.equal((await f.chat(tokens[0])).body.error.code,'DEPARTMENT_DISABLED');
  assert.ok(alice.id);
});

test('skills publish by department, update by revision and reject unsafe paths', async t => {
  const f = await fixture(t);
  const department = (await f.request('/admin/departments','POST',{name:'Research'},f.admin)).body;
  await f.create('alice',{departmentId:department.id}); await f.create('bob');
  const alice = await f.login('alice'), bob = await f.login('bob');
  const data = {name:'team-review',description:'Review code carefully',content:'Check tests and explain risks.',departmentIds:[department.id],files:{'references/rules.md':'Use small changes.'}};
  const skill = (await f.request('/admin/skills','POST',data,f.admin)).body;
  assert.equal((await f.request('/client/skills','GET',undefined,alice)).body.skills.length,1);
  assert.equal((await f.request('/client/skills','GET',undefined,bob)).body.skills.length,0);
  assert.equal((await f.request('/admin/skills','POST',{...data,name:'bad',files:{'../escape.md':'bad'}},f.admin)).status,400);
  assert.equal((await f.request('/admin/skills','POST',{...data,name:'bad',files:{'CON.txt':'bad'}},f.admin)).status,400);
  const updated = await f.request(`/admin/skills/${skill.id}`,'PUT',{...data,content:'New rules.',active:false},f.admin);
  assert.notEqual(updated.body.revision,skill.revision);
  assert.equal((await f.request('/client/skills','GET',undefined,alice)).body.skills.length,0);
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
