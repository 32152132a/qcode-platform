import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createDatabase,createVault} from '../src/database.js';
import {createApp} from '../src/app.js';
import {embedTexts} from '../src/embeddings.js';
import {catalogModelIssue} from '../src/model-sources.js';

test('embedding configuration validates vectors, rotates keys and restricts writes to administrators',async t=>{
 const db=createDatabase(),vault=createVault('a'.repeat(64));let invalid=false,dimensions=3;const calls=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);calls.push({url:req.url,key:req.headers.authorization,model:payload.model});if(req.headers.authorization==='Bearer rejected')return res.writeHead(402).end();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:payload.input.map((_,index)=>({index,embedding:invalid?[null,2]:Array.from({length:dimensions},(_,index)=>index+1)}))}));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>{upstream.closeAllConnections();upstream.close();});
 const source={id:'source',kind:'official',name:'测试站点',active:true,revision:1,base_url:'http://127.0.0.1:'+upstream.address().port,key_id:'rejected',fallback_key_ids:['working']};
 db.transaction(state=>{state.settings.modelSources.push(source);state.keys.push({id:'rejected',secret:vault.encrypt('rejected'),active:true},{id:'working',secret:vault.encrypt('working'),active:true});});
 const config={encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'admin-password',demoEnabled:true,timeoutMs:1000};
 const server=http.createServer(createApp(config,db));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();db.close();});
 const url='http://127.0.0.1:'+server.address().port;
 async function post(path,body,token){const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 const admin=(await post('/auth/login',{username:'admin',password:'admin-password'})).body.token;
 assert.equal((await post('/admin/models/embeddings/settings/update',{sourceId:'source',model:'text-embedding'},admin)).status,200);
 assert.deepEqual(db.read().settings.embedding,{sourceId:'source',model:'text-embedding',dimensions:3});assert.equal(db.read().keys[0].active,false);assert.deepEqual(calls.map(call=>call.key),['Bearer rejected','Bearer working']);assert(calls.every(call=>call.url==='/embeddings'));
 invalid=true;assert.equal((await post('/admin/models/embeddings/settings/update',{sourceId:'source',model:'invalid',confirmChange:true},admin)).status,502);assert.equal(db.read().settings.embedding.model,'text-embedding');invalid=false;
 const read=await post('/admin/models/embeddings/settings/detail',{},admin);assert.equal(read.body.dimensions,3);assert(!JSON.stringify(read.body).includes('working'));
 const callsBefore=calls.length;
 assert.equal((await post('/admin/models/embeddings/settings/update',{sourceId:'source',model:'new-embedding'},admin)).status,409);assert.equal(calls.length,callsBefore);assert.equal(db.read().settings.embedding.model,'text-embedding');
 dimensions=4;assert.equal((await post('/admin/models/embeddings/settings/update',{sourceId:'source',model:'text-embedding'},admin)).status,409);assert.equal(db.read().settings.embedding.dimensions,3);dimensions=3;
 assert.equal((await post('/admin/models/embeddings/settings/update',{sourceId:'source',model:'new-embedding',confirmChange:true},admin)).status,200);assert.equal(db.read().settings.embedding.model,'new-embedding');
 const demo=(await post('/auth/login',{username:'demo',password:'qcode-demo-2026'})).body.token;
 const before=calls.length;assert.equal((await post('/admin/models/embeddings/settings/update',{sourceId:'source',model:'text-embedding'},demo)).status,403);assert.equal(calls.length,before);
 await assert.rejects(()=>embedTexts({db,vault,config},{sourceId:'source',model:'text-embedding',texts:[]}),error=>error.code==='INVALID_EMBEDDING_INPUT');
 assert.equal(catalogModelIssue({id:'nomic-embed-text'},'local'),'暂不支持该类模型');
});
