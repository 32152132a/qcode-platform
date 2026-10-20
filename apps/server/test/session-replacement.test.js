import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {once} from 'node:events';
import {registerAuth} from '../src/auth.js';
import {createDatabase,hashPassword} from '../src/database.js';

async function fixture(t,limit){
 const db=createDatabase(),cancelled=[];db.transaction(s=>s.users.push({id:1,username:'employee',password_hash:hashPassword('employee-password'),role:'user',is_active:1,session_limit:limit,quotas:{},legacy_tokens:0},{id:2,username:'other',password_hash:hashPassword('other-password'),role:'user',is_active:1,session_limit:1,quotas:{},legacy_tokens:0}));
 const app=express();app.use(express.json());registerAuth(app,{db,config:{accessTokenMinutes:30,refreshTokenDays:30,loginFailureLimit:10,timezone:'Asia/Shanghai'},cancelRequests:(...args)=>cancelled.push(args)});app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code}));
 const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 async function request(route,body,token){const r=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
 async function login(username='employee',password='employee-password'){return request('/auth/login',{username,password});}
 return {db,cancelled,request,login};
}
test('new login replaces the old session after password verification and revokes both credentials',async t=>{
 const f=await fixture(t,1),first=await f.login(),other=await f.login('other','other-password'),old=f.db.read().tokens.find(s=>s.user_id===1);
 assert.equal((await f.login('employee','wrong-password')).status,401);assert.equal((await f.request('/auth/me',undefined,first.body.token)).status,200);assert.equal(f.cancelled.length,0);
 const latest=await f.login();assert.equal(latest.status,200);assert.equal((await f.request('/auth/me',undefined,first.body.token)).status,401);assert.equal((await f.request('/auth/refresh',{refreshToken:first.body.refreshToken})).status,401);assert.equal((await f.request('/auth/me',undefined,latest.body.token)).status,200);assert.equal((await f.request('/auth/me',undefined,other.body.token)).status,200);
 assert.deepEqual(f.cancelled,[[1,'SESSION_REPLACED',old.id]]);assert.equal(f.db.read().tokens.filter(s=>s.user_id===1).length,1);assert.ok(f.db.read().audits.some(a=>a.action==='session.replaced'));
});
test('multi-device limits replace only the oldest and concurrent logins stay bounded',async t=>{
 const f=await fixture(t,2),first=await f.login();f.db.transaction(s=>{s.tokens[0].created_at='2020-01-01T00:00:00Z';});const second=await f.login(),third=await f.login();
 assert.equal((await f.request('/auth/me',undefined,first.body.token)).status,401);assert.equal((await f.request('/auth/me',undefined,second.body.token)).status,200);assert.equal((await f.request('/auth/me',undefined,third.body.token)).status,200);
 const results=await Promise.all([f.login(),f.login(),f.login()]);assert.ok(results.every(r=>r.status===200));assert.equal(f.db.read().tokens.length,2);
});

test('zero login slots still reject login without removing existing sessions',async t=>{const f=await fixture(t,1),first=await f.login();f.db.transaction(s=>{s.users[0].session_limit=0;});assert.equal((await f.login()).status,409);assert.equal((await f.request('/auth/me',undefined,first.body.token)).status,200);assert.equal(f.cancelled.length,0);});
