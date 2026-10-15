import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './gateway.test.js';
import { GatewaySession, startBridge } from '../../client/bridge.mjs';

test('all enabled models are shared, preferences are defaults, and selected model keys stay separate',async t=>{
 const f=await fixture(t);const first=f.db.read().models[0];await f.create('alice',{modelId:first.id});
 const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
 const bridge=await startBridge(new GatewaySession(f.url,login,()=>{}));t.after(()=>bridge.close());
 const key=(await f.request('/admin/keys','POST',{keys:[{name:'Second provider',apiKey:'second-provider-secret'}]},f.admin)).body[0];
 const created=await f.request('/admin/models','POST',{name:'Second model',publicName:'second-model',upstreamModel:'private-second',baseUrl:first.base_url,keyId:key.id,active:true,maxOutputTokens:32},f.admin);assert.equal(created.status,201);const second=created.body;
 const config=(await f.request('/client/config','GET',undefined,login.token)).body;assert.equal(config.model,first.public_name);assert.deepEqual(config.models.map(m=>m.id),[first.public_name,'second-model']);assert.doesNotMatch(JSON.stringify(config.models),/second-provider-secret|private-second|base_url/);
 const headers={Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json'};
 const catalog=await(await fetch(bridge.baseUrl+'/models',{headers})).json();assert.equal(catalog.data.length,2,'new models appear without reinstalling the bridge');
 const response=await fetch(bridge.baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'second-model',messages:[{role:'user',content:'hello'}],max_tokens:999})});assert.equal(response.status,200);await response.text();
 assert.equal(f.received().body.model,'private-second');assert.equal(f.received().body.max_tokens,32);assert.equal(f.received().auth,'Bearer second-provider-secret');
 const record=f.db.read().requests.at(-1);assert.equal(record.model_id,second.id);assert.equal(record.key_id,key.id);
 f.db.transaction(state=>{state.models.find(model=>model.id===second.id).active=false;});const calls=f.calls();
 assert.equal((await f.chat(login.token,{model:'second-model'})).body.error.code,'INVALID_MODEL');assert.equal(f.calls(),calls);
});

test('no configured models still permits login, config and an empty catalog without forwarding a request',async t=>{
 const f=await fixture(t);await f.create();f.db.transaction(state=>{for(const model of state.models){model.active=false;model.is_default=false;}});
 const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
 assert.equal((await f.request('/auth/me','GET',undefined,login.token)).status,200);
 const config=await f.request('/client/config','GET',undefined,login.token);assert.equal(config.status,200);assert.equal(config.body.model,null);assert.deepEqual(config.body.models,[]);
 const bridge=await startBridge(new GatewaySession(f.url,login,()=>{}));t.after(()=>bridge.close());const headers={Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json'};
 assert.deepEqual((await(await fetch(bridge.baseUrl+'/models',{headers})).json()).data,[]);
 const response=await fetch(bridge.baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'qcode-model',messages:[{}]})});assert.equal(response.status,503);assert.equal(f.calls(),0);
});

test('disabled or removed defaults fall back to an enabled model',async t=>{
 const f=await fixture(t);const first=f.db.read().models[0];await f.create('alice',{modelId:first.id});const token=await f.login();
 f.db.transaction(state=>{state.models[0].active=false;state.models.push({...first,id:'fallback',public_name:'fallback-model',is_default:false,active:true});});
 const config=(await f.request('/client/config','GET',undefined,token)).body;assert.equal(config.model,'fallback-model');assert.deepEqual(config.models.map(model=>model.id),['fallback-model']);
});
