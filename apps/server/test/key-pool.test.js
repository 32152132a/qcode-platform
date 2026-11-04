import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './gateway.test.js';
import { createDatabase, createVault } from '../src/database.js';
import { restoreDueKeys, suspendKey, sourceKeyIds } from '../src/key-pool.js';

async function poolFixture(t, statuses = [402, 429, 200]) {
  const f = await fixture(t); await f.create(); const token = await f.login();
  const calls = [], source = f.db.read().settings.modelSources[0];
  const upstream = http.createServer(async (req, res) => {
    const index = Number(req.headers.authorization?.split('-').at(-1));
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({index, body: raw ? JSON.parse(raw) : null, path:req.url});
    const status = statuses[index];
    if (status === 'drop') { req.socket.destroy(); return; }
    if (status !== 200) return res.writeHead(status).end('private-upstream-detail');
    if (req.url === '/models') return res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({data:[{id:'private-model'}]}));
    if (calls.at(-1).body.stream) return res.writeHead(200, {'Content-Type':'text/event-stream'}).end('data: {"error":{"message":"private"}}\n\n');
    res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}));
  }); upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  t.after(()=>{upstream.closeAllConnections();upstream.close();});
  const keys=[];
  for (let i=0;i<statuses.length;i++) {
    const r=await f.request('/admin/keys','POST',{name:'Pool '+i,apiKey:'pool-key-'+i},f.admin);
    assert.equal(r.status,201);keys.push(r.body[0]);
  }
  const updated=await f.request('/admin/models/sources/'+source.id,'PUT',{keyIds:keys.map(key=>key.id),baseUrl:'http://127.0.0.1:'+upstream.address().port,autoSync:false},f.admin);
  assert.equal(updated.status,200);
  return {...f,token,calls,keys,source,statuses};
}

test('five rejected keys stay disabled; following requests go straight to the sixth key without changing models',async t=>{
  const f=await poolFixture(t,[402,402,402,402,402,200]);
  assert.equal((await f.chat(f.token)).status,200);
  assert.deepEqual(f.calls.map(call=>call.index),[0,1,2,3,4,5]);
  assert(f.calls.every(call=>call.body.model==='private-model'));
  for (const key of f.db.read().keys.filter(key=>f.keys.slice(0,5).some(item=>item.id===key.id))) {
    assert.equal(key.active,false);assert.equal(key.disabled_reason,'余额或额度不足');assert(key.disabled_at);
  }
  assert.equal((await f.chat(f.token)).status,200);
  assert.deepEqual(f.calls.map(call=>call.index),[0,1,2,3,4,5,5]);
  const rows=(await f.request('/admin/keys','GET',undefined,f.admin)).body;
  assert.equal(rows.find(key=>key.id===f.keys[0].id).requests,1);
  assert.equal(rows.find(key=>key.id===f.keys[5].id).tokens,10);
  assert(!JSON.stringify(rows).includes('pool-key-'));
  assert.equal(f.db.read().requests[0].key_id,f.keys[5].id);
  assert.equal(f.db.read().requests[0].key_attempts.length,6);
});

test('exhausted pools stop; manual enable retries only that key and recovery can be scheduled or cancelled',async t=>{
  const f=await poolFixture(t,[402,429]);
  const update=(id,body)=>f.request('/admin/keys/'+id,'PATCH',body,f.admin);
  assert.equal((await update(f.keys[0].id,{restoreHours:24})).status,200);
  assert.equal((await f.chat(f.token)).body.error.code,'KEY_UNAVAILABLE');assert.equal(f.calls.length,2);
  assert.equal((await f.chat(f.token)).status,503);assert.equal(f.calls.length,2);
  let key=f.db.read().keys.find(key=>key.id===f.keys[0].id);assert(key.restore_at);
  restoreDueKeys(f.db,new Date(Date.parse(key.restore_at)-1).toISOString());
  assert.equal(f.db.read().keys.find(item=>item.id===key.id).active,false);
  restoreDueKeys(f.db,key.restore_at);f.statuses[0]=200;
  assert.equal((await f.chat(f.token)).status,200);assert.equal(f.calls.at(-1).index,0);
  const future=new Date(Date.now()+60000).toISOString();
  assert.equal((await update(key.id,{restoreAt:future})).status,200);
  assert.equal((await update(key.id,{active:false})).status,200);
  assert.equal(f.db.read().keys.find(item=>item.id===key.id).restore_at,null);
  assert.equal((await update(key.id,{restoreHours:-1})).status,400);
  assert.equal((await update(key.id,{restoreAt:'invalid'})).status,400);
  assert.equal((await update(f.keys[1].id,{active:true})).status,200);
  f.statuses[1]=200;assert.equal((await f.chat(f.token)).status,200);assert.equal(f.calls.at(-1).index,1);
});

test('invalid user requests do not disable keys, and accepted stream errors never replay with another key',async t=>{
  const f=await poolFixture(t,[400,200]);
  assert.equal((await f.chat(f.token)).status,502);assert.equal(f.calls.length,1);
  assert.equal(f.db.read().keys.find(key=>key.id===f.keys[0].id).active,true);
  assert.equal((await f.chat(f.token,{messages:[]})).status,400);assert.equal(f.calls.length,1);
  f.statuses[0]=200;
  await fetch(f.url+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify({model:'qcode-model',messages:[{role:'user',content:'hi'}],stream:true,max_tokens:10})}).then(response=>response.text()).catch(()=>{});
  for (let i=0;i<100 && f.db.read().requests.at(-1).status === 'pending';i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.calls.length,2);assert.equal(f.db.read().keys.find(key=>key.id===f.keys[0].id).active,false);
});

test('keys belong to one source, may be assigned after creation, and disabled keys remain editable',async t=>{
  const f=await poolFixture(t);
  const other=(await f.request('/admin/models/sources','POST',{kind:'official',name:'Other',baseUrl:'https://example.com/v1',autoSync:false},f.admin)).body;
  assert.equal((await f.request('/admin/models/sources/'+other.id,'PUT',{keyIds:[f.keys[0].id]},f.admin)).status,409);
  assert.deepEqual(sourceKeyIds(f.db.read().settings.modelSources.find(s=>s.id===other.id)),[]);
  const created=await f.request('/admin/keys','POST',{name:'Assigned',apiKey:'assigned-secret',sourceId:other.id},f.admin);
  assert.equal(created.status,201);assert.equal(created.body[0].source_id,other.id);
  assert.equal((await f.request('/admin/keys/'+created.body[0].id,'DELETE',undefined,f.admin)).status,409);
  assert.equal((await f.request('/admin/keys/'+created.body[0].id,'PATCH',{sourceId:''},f.admin)).status,200);
  assert.equal((await f.request('/admin/keys/'+created.body[0].id,'DELETE',undefined,f.admin)).status,200);
  const local=(await f.request('/admin/models/sources','POST',{kind:'local',name:'Local',autoSync:false},f.admin)).body;
  assert.equal((await f.request('/admin/keys','POST',{name:'Invalid',apiKey:'local-secret',sourceId:local.id},f.admin)).status,400);
  await f.chat(f.token);
  assert.equal((await f.request('/admin/models/sources/'+f.source.id,'PUT',{keyIds:f.keys.map(key=>key.id)},f.admin)).status,200);
});

test('catalog synchronization uses the next key and shares disabled status with chat',async t=>{
  const f=await poolFixture(t);
  assert.equal((await f.request('/admin/models/sources/'+f.source.id+'/sync','POST',{},f.admin)).status,200);
  assert.deepEqual(f.calls.map(call=>call.index),[0,1,2]);
  assert.equal((await f.chat(f.token)).status,200);assert.deepEqual(f.calls.map(call=>call.index),[0,1,2,2]);
});

test('suspension and recovery schedules survive SQLite reopen; stale failures cannot disable a replaced secret',()=>{
  const folder=mkdtempSync(join(tmpdir(),'qcode-pool-')),file=join(folder,'test.sqlite'),vault=createVault('a'.repeat(64));
  let db;
  try {
    db=createDatabase(file,{vault});const key={id:'key',name:'test',secret:vault.encrypt('test-secret'),active:true,restore_hours:24};
    db.transaction(state=>state.keys.push(key));suspendKey(db,key,'余额或额度不足');db.close();db=createDatabase(file,{vault});
    const saved=db.read().keys[0];assert.equal(saved.active,false);assert(saved.restore_at);
    restoreDueKeys(db,saved.restore_at);assert.equal(db.read().keys[0].active,true);
    db.transaction(state=>{state.keys[0].secret=vault.encrypt('replacement');});suspendKey(db,key,'旧请求失败');
    assert.equal(db.read().keys[0].active,true);
  } finally {db?.close();rmSync(folder,{recursive:true,force:true});}
});
