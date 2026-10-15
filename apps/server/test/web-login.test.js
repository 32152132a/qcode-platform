import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {startWebLogin} from '../../client/web-login.mjs';

async function fixture(t,{saved=false,failStart=false,progress='',modelAvailable=true}={}){
 let session=saved?{token:'saved-token',refreshToken:'refresh',expiresAt:new Date(Date.now()+120000).toISOString(),user:{id:1}}:null,starts=0,stops=0,received;
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url==='/client/config')return res.writeHead(modelAvailable?200:503,{'Content-Type':'application/json'}).end(modelAvailable?'{}':JSON.stringify({error:{code:'MODEL_UNAVAILABLE',message:'private upstream configuration'}}));
  if(req.url==='/auth/me')return res.writeHead(200,{'Content-Type':'application/json'}).end('{"id":1}');
  if(req.url==='/auth/logout')return res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');
  received=JSON.parse(body);
  if(received.password!=='correct-password')return res.writeHead(401,{'Content-Type':'application/json'}).end('{"error":{"code":"LOGIN_FAILED","message":"private-provider-password"}}');
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({token:'gateway-access-secret',refreshToken:'gateway-refresh-secret',expiresAt:new Date(Date.now()+120000).toISOString(),user:{id:1,username:received.username}}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const local=await startWebLogin({gateway:`http://127.0.0.1:${server.address().port}`,store:{read:()=>session,write:value=>{session=value;}},hasSavedSession:saved,startClient:onProgress=>{starts++;if(progress)onProgress(progress);return {ready:failStart?Promise.reject(Error('secret startup detail')):Promise.resolve('http://127.0.0.1:39999/_qcode/start#local-bootstrap'),closed:new Promise(()=>{}),stop:async()=>{stops++;}};}});
 t.after(async()=>{await local.close();server.closeAllConnections();server.close();});
 const token=new URL(local.url).hash.slice(1),headers={'X-QCode-Launch':token,Origin:local.origin,'Content-Type':'application/json'};
 async function state(){return (await fetch(local.origin+'/status',{headers})).json();}
 async function wait(expected){for(let i=0;i<100;i++){const value=await state();if(value.state===expected)return value;await new Promise(r=>setTimeout(r,10));}throw Error('State timeout');}
 return {local,headers,state,wait,session:()=>session,starts:()=>starts,stops:()=>stops,received:()=>received,enableModel:()=>{modelAvailable=true;}};
}
test('Web login forwards credentials only to gateway and returns no gateway credentials to the browser',async t=>{
 const f=await fixture(t);const html=await (await fetch(f.local.origin+'/')).text();assert.match(html,/用户名/);assert.match(html,/显示密码/);assert.doesNotMatch(html,/gateway-access-secret|关闭 QCode|id="stop"/);
 const icon=await fetch(f.local.origin+'/icon.png');assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await icon.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal((await fetch(f.local.origin+'/status')).status,401);
 assert.equal((await fetch(f.local.origin+'/login',{method:'POST',headers:{...f.headers,Origin:'https://evil.example'},body:'{}'})).status,403);
 const wrong=await fetch(f.local.origin+'/login',{method:'POST',headers:f.headers,body:JSON.stringify({username:'alice',password:'wrong'})});assert.equal(wrong.status,401);assert.doesNotMatch(await wrong.text(),/private-provider-password/);
 const good=await fetch(f.local.origin+'/login',{method:'POST',headers:f.headers,body:JSON.stringify({username:'alice',password:'correct-password'})});assert.equal(good.status,200);assert.doesNotMatch(await good.text(),/gateway-access-secret|gateway-refresh-secret/);
 const ready=await f.wait('ready');assert.match(ready.url,/127.0.0.1/);assert.doesNotMatch(JSON.stringify(ready),/gateway-access-secret|gateway-refresh-secret/);assert.equal(f.session().token,'gateway-access-secret');assert.equal(f.starts(),1);assert.equal(f.received().password,'correct-password');
 assert.equal((await fetch(f.local.origin+'/login',{method:'POST',headers:f.headers,body:'{}'})).status,409);
});
test('saved login opens Web without credentials and startup errors stay on the page',async t=>{
 const f=await fixture(t,{saved:true});await f.wait('ready');assert.equal(f.starts(),1);
 const failed=await fixture(t,{failStart:true});await fetch(failed.local.origin+'/login',{method:'POST',headers:failed.headers,body:JSON.stringify({username:'alice',password:'correct-password'})});const status=await failed.wait('error');assert.match(status.message,/启动失败/);assert.doesNotMatch(JSON.stringify(status),/secret startup detail/);assert.equal(failed.stops(),1);
});
test('Web login rejects host rebinding, wrong bootstrap token and oversized credential bodies',async t=>{
 const f=await fixture(t);
 const host=await new Promise(resolve=>{http.get(f.local.origin+'/',{headers:{Host:'foreign.example'}},r=>{r.resume();resolve(r.statusCode);});});assert.equal(host,403);
 assert.equal((await fetch(f.local.origin+'/status',{headers:{'X-QCode-Launch':'wrong'}})).status,401);
 assert.equal((await fetch(f.local.origin+'/login',{method:'POST',headers:f.headers,body:'x'.repeat(9000)})).status,413);
 assert.equal(f.starts(),0);
});
test('update failures remain visible with a log location before opening the current version',async t=>{
 const f=await fixture(t,{saved:true,progress:'更新未完成，将继续使用当前版本。日志：C:/QCode/logs/update.log'});
 const ready=await f.wait('ready');assert.equal(ready.notice,true);assert.match(ready.message,/更新未完成/);assert.match(ready.message,/update.log/);assert.match(ready.url,/127.0.0.1/);
});

test('missing model is explained and retry starts after administrator assigns a model',async t=>{
 const f=await fixture(t,{saved:true,modelAvailable:false});
 const failed=await f.wait('error');assert.equal(failed.code,'MODEL_UNAVAILABLE');assert.match(failed.message,/分配启用的模型/);assert.equal(failed.retryable,true);assert.doesNotMatch(failed.message,/private upstream/);assert.equal(f.starts(),0);
 assert.equal((await fetch(f.local.origin+'/retry',{method:'POST'})).status,401);
 assert.equal((await fetch(f.local.origin+'/retry',{method:'POST',headers:{...f.headers,Origin:'https://evil.example'}})).status,403);
 f.enableModel();const response=await fetch(f.local.origin+'/retry',{method:'POST',headers:f.headers,body:'{}'});assert.equal(response.status,200);await f.wait('ready');assert.equal(f.starts(),1);
});
