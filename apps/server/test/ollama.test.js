import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createApp,readConfig} from '../src/app.js';
import {createDatabase} from '../src/database.js';

test('Ollama keyless chat, catalogue and connectivity retain gateway auth, quotas and accounting',async t=>{
  const received=[];
  const upstream=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,undefined,'never forward a cloud API key to Ollama');
    if(req.url==='/v1/models')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qwen:0.5b'}]}));
    let input='';for await(const bytes of req)input+=bytes;const body=JSON.parse(input);received.push(body);
    assert.equal(body.model,'qwen:0.5b');
    const usage={prompt_tokens:4,completion_tokens:2,total_tokens:6};
    if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'OK'}}]})+'\n\n');res.write('data: '+JSON.stringify({choices:[],usage})+'\n\n');res.end('data: [DONE]\n\n');}
    else res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}],usage}));
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const baseUrl=`http://127.0.0.1:${upstream.address().port}/v1`,db=createDatabase();
  const config={encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'admin-password',ollamaBaseUrl:baseUrl};
  const app=createApp(config,db),server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  async function request(route,method='GET',body,token){const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();return {status:r.status,body:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text};}
  const admin=(await request('/auth/login','POST',{username:'admin',password:'admin-password'})).body.token;
  const model=db.read().models.find(m=>m.public_name==='qcode-qwen-local');assert.equal(model.key_id,null);assert.equal(model.is_default,false);
  const catalog=await request('/admin/models/catalog','POST',{baseUrl,provider:'ollama'},admin);assert.deepEqual(catalog.body.models,['qwen:0.5b']);
  const check=await request(`/admin/models/${model.id}/check`,'POST',{},admin);assert.equal(check.body.status,'connected');assert.equal(check.body.tools,false);assert.equal(check.body.tool_result,false);assert.equal(received[0].tools,undefined);
  const cloudKey=(await request('/admin/keys','POST',{name:'Unrelated cloud key',apiKey:'synthetic-cloud-key'},admin)).body[0];
  const user=await request('/admin/users','POST',{username:'employee',password:'employee-password',modelId:model.id,keyId:cloudKey.id},admin);assert.equal(user.status,201);
  const session=(await request('/auth/login','POST',{username:'employee',password:'employee-password'})).body.token;
  const body={model:model.public_name,messages:[{role:'user',content:'hello'}],max_tokens:16};
  assert.equal((await request('/v1/chat/completions','POST',body)).status,401);
  assert.equal((await request(`/admin/models/${model.id}/check`,'POST',{},session)).status,403);
  const json=await request('/v1/chat/completions','POST',body,session);assert.equal(json.status,200);assert.equal(json.body.choices[0].message.content,'OK');
  for(let attempt=0;attempt<40&&db.read().requests.some(r=>r.status==='pending');attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(db.read().requests.some(r=>r.status==='pending'),false);
  const stream=await request('/v1/chat/completions','POST',{...body,stream:true},session);assert.equal(stream.status,200);assert.match(stream.body,/OK/);
  for(let attempt=0;attempt<40&&db.read().requests.some(r=>r.status==='pending');attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(db.read().requests.every(r=>r.key_id===null&&r.total_tokens===6));
  await request(`/admin/users/${user.body.id}`,'PATCH',{quotas:{totalRequests:1}},admin);
  assert.equal((await request('/v1/chat/completions','POST',body,session)).status,429);
  assert.equal((await request('/admin/models','POST',{name:'Invalid',publicName:'invalid',provider:'ollama',protocol:'responses',baseUrl,upstreamModel:'qwen:0.5b'},admin)).status,400);
  const relay=(await request('/admin/models','POST',{name:'Cloud',publicName:'cloud',baseUrl,upstreamModel:'cloud'},admin)).body;
  await request(`/admin/users/${user.body.id}`,'PATCH',{modelId:relay.id,keyId:null},admin);
  assert.equal((await request('/v1/chat/completions','POST',{...body,model:'cloud'},session)).status,503,'cloud providers still require a key');
});

test('optional Ollama provisioning is once-only and preserves configured default and assignments',()=>{
  const db=createDatabase(),config={encryptionSecret:'b'.repeat(64),adminUsername:'admin',adminPassword:'admin-password',baseUrl:'http://127.0.0.1:9/v1',upstreamModel:'existing',ollamaBaseUrl:'http://127.0.0.1:11434/v1'};
  createApp(config,db);const before=db.read();assert.equal(before.models.length,2);assert.equal(before.models.find(m=>m.is_default).upstream_model,'existing');assert.equal(before.users[0].model_id,null);
  const local=before.models.find(m=>m.provider==='ollama');db.transaction(state=>{state.models.find(m=>m.id===local.id).base_url='http://updated.example/v1';});
  createApp(config,db);assert.equal(db.read().models.length,2);assert.equal(db.read().models.find(m=>m.id===local.id).base_url,'http://updated.example/v1');
  db.transaction(state=>{state.models=state.models.filter(m=>m.id!==local.id);});createApp(config,db);assert.equal(db.read().models.length,1,'deleted seed is not resurrected');
  assert.throws(()=>readConfig({KEY_ENCRYPTION_SECRET:'b'.repeat(64),OLLAMA_BASE_URL:'not-a-url'}));
});
