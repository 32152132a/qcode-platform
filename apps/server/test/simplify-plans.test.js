import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, createVault } from '../src/database.js';
import { simplifyPlans } from '../scripts/simplify-plans.js';
import { checkQuota } from '../src/policy.js';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-plan-migration-')),filename=path.join(dir,'test.sqlite'),backupPath=path.join(dir,'before.backup'),secret='a'.repeat(64),vault=createVault(secret);
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const db=createDatabase(filename,{vault});
 db.transaction(state=>{
  state.users=[{id:1,username:'tester',model_id:'model',max_concurrent_requests:3,quotas:{totalTokens:100}}];
  state.keys=[{id:'key',secret:vault.encrypt('test-secret')}];
  state.plans=[{id:'unlimited',quotas:{totalTokens:0,totalRequests:5},max_concurrent_requests:3},{id:'limited',quotas:{totalTokens:1000},max_concurrent_requests:1}];
  state.subscriptions=[{id:'sub',user_id:1,terms:{quotas:{totalTokens:1000}},started_at:'2026-01-01',expires_at:'2027-01-01'}];
  state.planOrders=[{id:'order',status:'pending',terms:{quotas:{totalTokens:0}}}];
  state.requests=[{id:'usage',model_id:'model',user_id:1,subscription_id:'sub',status:'success',total_tokens:37}];
 });
 const original=db.read();db.close();original.version=5;
 const sql=new DatabaseSync(filename);const metadata=JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data);metadata.version=5;sql.prepare('UPDATE metadata SET data=? WHERE id=1').run(JSON.stringify(metadata));sql.exec('PRAGMA user_version=5');sql.close();
 return {filename,backupPath,secret,original};
}
test('offline plan migration preserves usage and periods, backs up before applying, and runs once',t=>{
 const f=fixture(t),before=fs.readFileSync(f.filename);
 assert.throws(()=>createDatabase(f.filename),/Unsupported database version/);
 assert.equal(simplifyPlans(f).plans,2);assert.deepEqual(fs.readFileSync(f.filename),before);assert(!fs.existsSync(f.backupPath));
 assert.equal(simplifyPlans({...f,apply:true}).version,6);
 const backup=JSON.parse(createVault(f.secret).decrypt(JSON.parse(fs.readFileSync(f.backupPath)).ciphertext));assert.deepEqual(backup.state,f.original);
 const db=createDatabase(f.filename,{vault:createVault(f.secret)});try{
  const state=db.read();assert.equal(state.plans[0].token_limit,null);assert.equal(state.plans[1].token_limit,1000);
  assert(!Object.hasOwn(state.users[0],'model_id'));assert(!Object.hasOwn(state.users[0],'max_concurrent_requests'));assert(!Object.hasOwn(state.plans[0],'quotas'));
  assert.equal(state.subscriptions[0].started_at,f.original.subscriptions[0].started_at);assert.equal(state.subscriptions[0].expires_at,f.original.subscriptions[0].expires_at);assert.deepEqual(state.requests,f.original.requests);assert.deepEqual(state.keys,f.original.keys);
 }finally{db.close();}
 assert.equal(simplifyPlans({...f,apply:true}).alreadyApplied,true);
});
test('migration rejects wrong key and an existing backup without touching the source',t=>{
 const f=fixture(t),before=fs.readFileSync(f.filename);
 assert.throws(()=>simplifyPlans({...f,apply:true,secret:'b'.repeat(64)}));assert.deepEqual(fs.readFileSync(f.filename),before);
 fs.writeFileSync(f.backupPath,'keep');assert.throws(()=>simplifyPlans({...f,apply:true}),/EEXIST/);assert.deepEqual(fs.readFileSync(f.filename),before);
});
test('zero token allowance is exhausted; null is unlimited',()=>{
 assert.throws(()=>checkQuota({totalTokens:0},{totalTokens:0},1),{code:'QUOTA_EXCEEDED'});
 assert.doesNotThrow(()=>checkQuota({totalTokens:null},{totalTokens:999},100000));
});
