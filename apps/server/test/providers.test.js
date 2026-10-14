import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { providerRequest, responseStream } from '../src/providers.js';

async function fixture(t) {
  const received=[];let mode='success';
  const upstream=http.createServer(async(req,res)=>{
    if(req.url==='/v1/models')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'gpt-test'},{id:'gemini-test'},{id:'claude-test'},{id:'grok-test'},{id:'mistral-test'}]}));
    let text='';for await(const bytes of req)text+=bytes;
    const body=JSON.parse(text);received.push({path:req.url,auth:req.headers.authorization,body});
    if(mode==='delay')await new Promise(resolve=>setTimeout(resolve,80));
    if(mode==='failure')return res.writeHead(401).end('sk-secret-private upstream-address');
    const tool=body.tool_choice?.type==='function';
    if(body.model==='deepseek-test'&&tool&&body.thinking?.type!=='disabled')return res.writeHead(400).end('forced tools unsupported in thinking mode');
    const usage={input_tokens:5,output_tokens:3,total_tokens:8};
    if(req.url==='/v1/responses'){
      if(!body.stream)return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'response_test',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}],usage}));
      res.writeHead(200,{'content-type':'text/event-stream'});
      const values=tool?[
        {type:'response.output_item.added',output_index:2,item:{type:'function_call',call_id:'call_test',name:body.tools[0].name,arguments:''}},
        {type:'response.function_call_arguments.delta',output_index:2,delta:'{"ok":'},
        {type:'response.function_call_arguments.delta',output_index:2,delta:'true}'},
        {type:'response.function_call_arguments.done',output_index:2,arguments:'{"ok":true}'},
      ]:[{type:'response.output_text.delta',delta:'浣犲ソ'}];
      if(mode!=='truncated')values.push({type:'response.completed',response:{id:'response_test',status:'completed',usage}});
      const bytes=Buffer.from(values.map(value=>`event: ${value.type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`).join(''));
      for(let i=0;i<bytes.length;i+=7)res.write(bytes.subarray(i,i+7));return res.end();
    }
    const chatUsage={prompt_tokens:5,completion_tokens:3,total_tokens:8};
    if(body.stream){
      res.writeHead(200,{'content-type':'text/event-stream'});
      const call={index:0,id:'call_test',type:'function',function:{name:body.tools?.[0]?.function.name,arguments:'{"ok":true}'},extra_content:{google:{thought_signature:'opaque-signature'}}};
      res.end(`data: ${JSON.stringify({choices:[{index:0,delta:tool?{tool_calls:[call]}:{content:'浣犲ソ'}}],usage:chatUsage})}\n\ndata: [DONE]\n\n`);
    }else res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}],usage:chatUsage}));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const db=createDatabase();const server=http.createServer(createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'admin-password',timeoutMs:2000},db));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
  const url=`http://127.0.0.1:${server.address().port}`,baseUrl=`http://127.0.0.1:${upstream.address().port}/v1`;
  async function request(path,method='GET',body,token){const response=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
  const admin=(await request('/auth/login','POST',{username:'admin',password:'admin-password'})).body.token;
  const key=(await request('/admin/keys','POST',{name:'Relay key',apiKey:'sk-test-private-relay'},admin)).body[0];
  async function model(provider,protocol='chat-completions'){
    const result=await request('/admin/models','POST',{name:provider,provider,protocol,publicName:`qcode-${provider}`,baseUrl,upstreamModel:`${provider}-test`,keyId:key.id,maxOutputTokens:256,active:true},admin);
    assert.equal(result.status,201);return result.body;
  }
  return {url,request,admin,key,model,db,received,mode:value=>mode=value};
}
test('all relay brands support model-bound keys, catalogue and streaming tool round trips',async t=>{
  const f=await fixture(t);
  for(const family of ['gpt','gemini','claude','grok','mistral','deepseek']){
    const model=await f.model(family,family==='gpt'?'responses':'chat-completions');
    const catalogue=await f.request('/admin/models/catalog','POST',{baseUrl:model.base_url,keyId:f.key.id},f.admin);assert.equal(catalogue.status,200);assert.equal(catalogue.body.models.length,5);
    const checked=await f.request(`/admin/models/${model.id}/check`,'POST',{},f.admin);
    assert.equal(checked.body.status,'verified',JSON.stringify(checked));assert.equal(checked.body.tool_result,true);
    const forward=f.received.at(-1);assert.equal(forward.auth,'Bearer sk-test-private-relay');
    if(family==='deepseek'){assert.equal(forward.body.thinking.type,'disabled');assert.equal(checked.body.test_mode,'non-thinking');}
    if(family==='gpt'){assert.equal(forward.path,'/v1/responses');assert.ok(forward.body.input.some(item=>item.type==='function_call_output'));}
    if(family==='gemini')assert.equal(forward.body.messages[1].tool_calls[0].extra_content.google.thought_signature,'opaque-signature');
    const user=await f.request('/admin/users','POST',{username:family,password:'user-password',modelId:model.id},f.admin);assert.equal(user.status,201);
    const login=await f.request('/auth/login','POST',{username:family,password:'user-password'});
    const chat=await f.request('/v1/chat/completions','POST',{model:model.public_name,messages:[{role:'user',content:'hello'}],max_tokens:20},login.body.token);assert.equal(chat.status,200);assert.equal(chat.body.choices[0].message.content,'OK');
    const stream=await fetch(f.url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${login.body.token}`},body:JSON.stringify({model:model.public_name,messages:[{role:'user',content:'hello'}],stream:true,max_tokens:20})});
    assert.equal(stream.status,200);assert.match(await stream.text(),/浣犲ソ/);
    assert.equal((await f.request(`/admin/models/${model.id}/check`,'POST',{},login.body.token)).status,403);
  }
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.db.read().requests.filter(r=>r.status==='pending').length,0);
  assert.ok(f.db.read().requests.filter(r=>r.purpose==='model_check').every(r=>r.total_tokens===8));
  assert.equal((await f.request(`/admin/keys/${f.key.id}`,'DELETE',undefined,f.admin)).status,409);
  assert.equal((await f.request(`/admin/keys/${f.key.id}`,'PATCH',{apiKey:'sk-test-replaced'},f.admin)).status,200);
  assert.ok(f.db.read().models.every(m=>m.verification===null));
  const model=f.db.read().models[0];const replaced=await f.request(`/admin/models/${model.id}`,'PUT',{name:'New upstream',publicName:model.public_name,baseUrl:model.base_url,upstreamModel:'replacement',protocol:'responses',keyId:f.key.id},f.admin);assert.equal(replaced.status,200);assert.equal(replaced.body.verification,null);
});
test('failed provider probes are sanitized, logged, and never marked verified',async t=>{
  const f=await fixture(t),model=await f.model('gpt','responses');f.mode('failure');
  const checked=await f.request(`/admin/models/${model.id}/check`,'POST',{},f.admin);
  assert.equal(checked.body.status,'failed');assert.match(checked.body.message,/Key 无效/);assert.doesNotMatch(JSON.stringify(checked),/sk-secret|upstream-address/);
  assert.equal(f.db.read().requests[0].status,'failed');assert.ok(f.db.read().requests[0].charged_tokens>0);
  assert.equal((await f.request(`/admin/models/${model.id}`,'PUT',{name:'GPT',publicName:'gpt',baseUrl:'https://example.test/v1',upstreamModel:'gpt',protocol:'gemini-native'},f.admin)).status,400);
});
test('Responses adapter rejects truncated streams and preserves multiple tool argument indexes',async()=>{
  const events=[{type:'response.output_item.added',output_index:3,item:{type:'function_call',call_id:'one',name:'a',arguments:''}},{type:'response.output_item.added',output_index:8,item:{type:'function_call',call_id:'two',name:'b',arguments:''}},{type:'response.function_call_arguments.done',output_index:8,arguments:'{}'},{type:'response.completed',response:{usage:{input_tokens:1,output_tokens:2,total_tokens:3}}}];
  const output=[];for await(const part of responseStream((async function*(){yield Buffer.from(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));})(),{public_name:'public'}))output.push(part);
  assert.match(output.join(''),/"index":1/);assert.match(output.join(''),/tool_calls/);assert.match(output.join(''),/\[DONE\]/);
  await assert.rejects(async()=>{for await(const _ of responseStream((async function*(){yield Buffer.from('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');})(),{})){}},e=>e.code==='INCOMPLETE_STREAM');
  assert.throws(()=>providerRequest({messages:[],stop:['end']},{protocol:'responses'},'key',20),e=>e.code==='UNSUPPORTED_PARAMETER');
});

test('key rotation during a probe prevents a second paid request and invalidates the result',async t=>{
  const f=await fixture(t),model=await f.model('gpt','responses');f.mode('delay');
  const pending=f.request(`/admin/models/${model.id}/check`,'POST',{},f.admin);
  while(!f.received.length)await new Promise(resolve=>setTimeout(resolve,5));
  await f.request(`/admin/keys/${f.key.id}`,'PATCH',{apiKey:'sk-rotated-while-checking'},f.admin);
  const result=await pending;assert.equal(result.body.status,'stale');assert.equal(f.received.length,1);assert.notEqual(f.db.read().models[0].verification?.status,'verified');
});
test('diagnostic requests honor quotas and unsupported request parameters never create pending reservations',async t=>{
  const f=await fixture(t),model=await f.model('gpt','responses');
  f.db.transaction(state=>{state.users[0].quotas.totalRequests=1;});
  const result=await f.request(`/admin/models/${model.id}/check`,'POST',{},f.admin);
  assert.equal(result.body.status,'failed');assert.equal(result.body.error_code,'QUOTA_EXCEEDED');assert.equal(f.received.length,1);
  const user=await f.request('/admin/users','POST',{username:'params',password:'user-password',modelId:model.id},f.admin);assert.equal(user.status,201);
  const login=await f.request('/auth/login','POST',{username:'params',password:'user-password'});
  const failed=await f.request('/v1/chat/completions','POST',{model:model.public_name,messages:[{role:'user',content:'hello'}],stop:['end']},login.body.token);
  assert.equal(failed.status,400);assert.equal(f.db.read().requests.filter(r=>r.user_id===user.body.id).length,0);
});
