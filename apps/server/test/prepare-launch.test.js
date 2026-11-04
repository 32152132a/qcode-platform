import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareLaunchDatabase } from '../scripts/prepare-launch.js';
import { createVault } from '../src/database.js';
import { emptyState } from '../src/state.js';

function inspectV4(filename) {
  const sql=new DatabaseSync(filename);try{
    const state=JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data);
    for(const {name} of sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'metadata'").all())state[name]=sql.prepare('SELECT data FROM "'+name+'" ORDER BY rowid').all().map(row=>JSON.parse(row.data));
    return state;
  }finally{sql.close()}
}
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-launch-')),filename=path.join(root,'data.sqlite'),backupPath=path.join(root,'before.qcode-backup'),secret='a'.repeat(64);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state=emptyState();state.version=3;state.nextUserId=2;
  state.settings.modelSources=[{id:'source'}];
  state.users=[{id:1,username:'staff',session_limit:1,max_concurrent_requests:1,quotas:{totalTokens:100},quota_mode:'custom',department_id:null,legacy_tokens:0}];
  state.tokens=[{token_hash:'token',id:'session',refresh_hash:'refresh',refresh_expires_at:'2099-01-01'}];
  state.keys=[{id:'key',secret:createVault(secret).encrypt('provider-secret')}];
  state.models=[{id:'model',source_id:'source',context_window:131072,input_price:0,output_price:0,currency:'CNY',max_tokens_field:'max_tokens'}];
  state.plans=['基础版','test','plus','pro'].map((name,index)=>({id:String(index),name,price_cents:[0,0,2000,10000][index],active:true}));
  for(const table of ['skills','feedback','paymentSettings','planOrders','requests','audits','loginFailures'])state[table]=[{id:table+'-fixture',text:'preserve or clear'}];
  const sql=new DatabaseSync(filename);
  sql.exec('CREATE TABLE metadata (id INTEGER PRIMARY KEY,data TEXT); PRAGMA user_version=3;');
  const metadata={};for(const [name,value] of Object.entries(state)){
    if(!Array.isArray(value)){metadata[name]=value;continue;}
    sql.exec('CREATE TABLE "'+name+'" (id TEXT PRIMARY KEY,data TEXT)');
    for(const row of value)sql.prepare('INSERT INTO "'+name+'" VALUES (?,?)').run(String(row.token_hash||row.id),JSON.stringify(row));
  }
  sql.prepare('INSERT INTO metadata VALUES(1,?)').run(JSON.stringify(metadata));sql.close();
  return {filename,backupPath,secret,state};
}
test('launch cleanup previews without writes, preserves business data and creates a restorable original backup',t=>{
  const f=fixture(t),original=fs.readFileSync(f.filename);
  assert.equal(prepareLaunchDatabase(f).version,3);assert.deepEqual(fs.readFileSync(f.filename),original);assert(!fs.existsSync(f.backupPath));
  const result=prepareLaunchDatabase({...f,apply:true});assert.equal(result.version,4);
  const wrapper=JSON.parse(fs.readFileSync(f.backupPath)),payload=JSON.parse(createVault(f.secret).decrypt(wrapper.ciphertext));
  assert.equal(payload.format,'qcode-backup-v3');assert.deepEqual(payload.state,f.state);
  {
    const state=inspectV4(f.filename);for(const name of ['tokens','keys','models','skills','feedback','paymentSettings'])assert.deepEqual(state[name],f.state[name],name);
    assert.equal(state.users[0].username,'staff');assert.equal(state.users[0].quotas.totalTokens,100);assert(!Object.hasOwn(state.users[0],'legacy_tokens'));
    for(const name of ['planOrders','requests','audits','loginFailures'])assert.equal(state[name].length,0);
    assert.deepEqual(state.plans.map(p=>p.level),[0,1,2,3]);assert.equal(state.plans.find(p=>p.is_default).name,'基础版');
    const sql=new DatabaseSync(f.filename);try{sql.prepare('INSERT INTO requests VALUES (?,?)').run('new',JSON.stringify({id:'new',status:'success',total_tokens:2}));}finally{sql.close()}
  }
  assert.equal(prepareLaunchDatabase({...f,apply:true}).alreadyApplied,true);
  assert.equal(inspectV4(f.filename).requests.length,1);
});
test('unexpected paid subscriptions stop the operation before backup or data changes',t=>{
  const f=fixture(t),sql=new DatabaseSync(f.filename);sql.prepare('INSERT INTO subscriptions VALUES (?,?)').run('new',JSON.stringify({id:'new',plan_id:'2'}));sql.close();
  const original=fs.readFileSync(f.filename);assert.throws(()=>prepareLaunchDatabase({...f,apply:true}),/Subscriptions appeared/);assert.deepEqual(fs.readFileSync(f.filename),original);assert(!fs.existsSync(f.backupPath));
});
test('wrong encryption secrets and existing backup files cannot change the database',t=>{
  const f=fixture(t),original=fs.readFileSync(f.filename);
  assert.throws(()=>prepareLaunchDatabase({...f,apply:true,secret:'b'.repeat(64)}));assert.deepEqual(fs.readFileSync(f.filename),original);
  fs.writeFileSync(f.backupPath,'keep');assert.throws(()=>prepareLaunchDatabase({...f,apply:true}),/EEXIST/);assert.deepEqual(fs.readFileSync(f.filename),original);assert.equal(fs.readFileSync(f.backupPath,'utf8'),'keep');
});
