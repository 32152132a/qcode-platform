import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createDatabase,createVault} from '../src/database.js';
import {removeDepartments} from '../scripts/remove-departments.js';
import {fixture as gatewayFixture} from './gateway.test.js';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-remove-teams-')),filename=path.join(dir,'test.sqlite'),backupPath=path.join(dir,'before.qcode-backup'),secret='a'.repeat(64),vault=createVault(secret);
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const db=createDatabase(filename,{vault});
 db.transaction(state=>{
  state.nextUserId=3;
  state.users=[{id:1,username:'inherited',role:'user',is_active:1,department:'Team',department_id:'team',quota_mode:'department',quotas:{totalTokens:1},model_id:null,key_id:null},{id:2,username:'custom',role:'user',department_id:'team',quota_mode:'custom',quotas:{totalTokens:500},model_id:'model',key_id:'key'}];
  state.keys=[{id:'key',secret:vault.encrypt('test-private-key'),active:true}];
  state.models=[{id:'model',name:'Test',active:true}];
  state.tokens=[{id:'session',token_hash:'token',user_id:1,refresh_expires_at:'2099-01-01'}];
  state.plans=[{id:'plan',name:'Plan',level:1}];state.subscriptions=[{id:'subscription',user_id:2,plan_id:'plan',terms:{model_ids:['model'],quotas:{totalTokens:500}}}];
  state.skills=[{id:'skill',name:'test-skill',active:true,department_ids:['team'],files:{'SKILL.md':'Hello'}},{id:'knowledge',name:'test-doc',kind:'knowledge',active:true,department_ids:[],files:{'references/document.md':'Document'}}];
  state.requests=[{id:'request',user_id:1,status:'success',total_tokens:80,cost_micros:3,department_id:'team',department_name:'Team'}];
  state.feedback=[{id:'feedback',content:'Test feedback'}];state.paymentSettings=[{id:'qr',qr_data_url:'data:image/png;base64,test'}];state.audits=[{id:'audit',action:'user.create'}];state.planOrders=[{id:'order',status:'approved'}];
 });
 const original=db.read();db.close();
 original.version=4;original.departments=[{id:'team',name:'Team',model_id:'model',key_id:'key',user_quotas:{totalTokens:1000}}];
 const sql=new DatabaseSync(filename);
 try{
  sql.exec('CREATE TABLE departments (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE INDEX request_department ON requests(json_extract(data, \'$.department_id\')); PRAGMA user_version=4;');
  sql.prepare('INSERT INTO departments VALUES (?,?)').run('team',JSON.stringify(original.departments[0]));
  const metadata=JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data);metadata.version=4;sql.prepare('UPDATE metadata SET data=? WHERE id=1').run(JSON.stringify(metadata));
 }finally{sql.close()}
 return {filename,backupPath,secret,original};
}

test('department migration is explicit, backed up and atomic; preserves business data and inherited user settings',t=>{
 const f=fixture(t),bytes=fs.readFileSync(f.filename);
 assert.throws(()=>createDatabase(f.filename),/Unsupported database version/);
 const preview=removeDepartments(f);assert.equal(preview.removedDepartments,1);assert.deepEqual(fs.readFileSync(f.filename),bytes);assert(!fs.existsSync(f.backupPath));
 assert.equal(removeDepartments({...f,apply:true}).version,5);
 const wrapper=JSON.parse(fs.readFileSync(f.backupPath));assert(!JSON.stringify(wrapper).includes('test-private-key'));
 const backup=JSON.parse(createVault(f.secret).decrypt(wrapper.ciphertext));assert.equal(backup.format,'qcode-backup-v4');assert.deepEqual(backup.state,f.original);
 const migrated=new DatabaseSync(f.filename,{readOnly:true});try{
  const metadata=JSON.parse(migrated.prepare('SELECT data FROM metadata WHERE id=1').get().data);
  const state={...metadata};for(const table of Object.keys(f.original).filter(name=>Array.isArray(f.original[name])&&name!=='departments'))state[table]=migrated.prepare('SELECT data FROM "'+table+'" ORDER BY rowid').all().map(row=>JSON.parse(row.data));assert.equal(state.version,5);assert(!Object.hasOwn(state,'departments'));
  for(const user of state.users)for(const field of ['department','department_id','quota_mode'])assert(!Object.hasOwn(user,field));
  assert.deepEqual(state.users[0].quotas,{totalTokens:1000});assert.equal(state.users[0].model_id,'model');assert.equal(state.users[0].key_id,'key');assert.deepEqual(state.users[1].quotas,{totalTokens:500});
  for(const table of ['keys','models','tokens','plans','subscriptions','feedback','paymentSettings','audits','planOrders'])assert.deepEqual(state[table],f.original[table],table);
  assert.equal(state.requests[0].total_tokens,80);assert.equal(state.requests[0].cost_micros,3);assert(!Object.hasOwn(state.requests[0],'department_id'));assert(!Object.hasOwn(state.requests[0],'department_name'));
  assert(state.skills.every(skill=>!Object.hasOwn(skill,'department_ids')));assert.deepEqual(state.skills.map(skill=>skill.files),f.original.skills.map(skill=>skill.files));
 }finally{migrated.close()}
 const sql=new DatabaseSync(f.filename,{readOnly:true});try{assert.equal(sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('departments','request_department')").get().n,0)}finally{sql.close()}
 assert.equal(removeDepartments({...f,apply:true}).alreadyApplied,true);
});

test('migration rejects wrong secrets, active requests and backup overwrite without changing the database',t=>{
 const f=fixture(t),bytes=fs.readFileSync(f.filename);
 assert.throws(()=>removeDepartments({...f,apply:true,secret:'b'.repeat(64)}));assert.deepEqual(fs.readFileSync(f.filename),bytes);assert(!fs.existsSync(f.backupPath));
 fs.writeFileSync(f.backupPath,'keep');assert.throws(()=>removeDepartments({...f,apply:true}),/EEXIST/);assert.deepEqual(fs.readFileSync(f.filename),bytes);assert.equal(fs.readFileSync(f.backupPath,'utf8'),'keep');
 const sql=new DatabaseSync(f.filename);try{sql.prepare('INSERT INTO requests VALUES (?,?)').run('pending',JSON.stringify({id:'pending',status:'pending'}))}finally{sql.close()}
 const pendingBytes=fs.readFileSync(f.filename);assert.throws(()=>removeDepartments({...f,apply:true,backupPath:path.join(path.dirname(f.filename),'another.backup')}),/进行中的请求/);assert.deepEqual(fs.readFileSync(f.filename),pendingBytes);
});

test('runtime has no department endpoints or permissions and shares enabled skills with all accounts',async t=>{
 const f=await gatewayFixture(t);const user=await f.create();const token=await f.login();
 assert(!Object.hasOwn(user,'department_id'));assert(!Object.hasOwn(user,'quota_mode'));assert(!Object.hasOwn(f.db.read(),'departments'));
 const admin=(await f.request('/auth/me','GET',undefined,f.admin)).body;assert(admin.permissions.every(value=>!value.startsWith('departments:')));
 const response=await fetch(f.url+'/admin/departments/list',{method:'POST',headers:{Authorization:'Bearer '+f.admin}});assert.notEqual(response.status,200);
 await f.request('/admin/skills','POST',{name:'shared-test',description:'Shared',content:'Test skill'},f.admin);
 assert.deepEqual((await f.request('/client/skills','GET',undefined,token)).body.skills.map(item=>item.name).sort(),['qcode-knowledge','shared-test']);
});
