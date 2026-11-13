import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {once} from 'node:events';
import {registerAuth} from '../src/auth.js';
import {createDatabase,hashPassword} from '../src/database.js';

async function fixture(t,limit){
 const db=createDatabase(),cancelled=[];db.transaction(s=>s.users.push({id:1,username:'employee',password_hash:hashPassword('employee-password'),role:'user',is_active:1,session_limit:limit,quotas:{}},{id:2,username:'other',password_hash:hashPassword('other-password'),role:'user',is_active:1,session_limit:1,quotas:{}}));
 const app=express();app.use(express.json());registerAuth(app,{db,config:{accessTokenMinutes:30,refreshTokenDays:30,loginFailureLimit:10,timezone:'Asia/Shanghai'},cancelRequests:(...args)=>cancelled.push(args)});app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code}));
 const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 async function request(route,body,token){const r=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
 async function login(username='employee',password='employee-password'){return request('/auth/login',{username,password});}
 return {db,cancelled,request,login};
}
test('multiple logins can remain active and logout only revokes the current session', async t => {
  const f = await fixture(t, 1);
  const first = await f.login(), second = await f.login();
  for (const session of [first, second])
    assert.equal((await f.request('/auth/me', undefined, session.body.token)).status, 200);
  assert.equal((await f.request('/auth/logout', {}, second.body.token)).status, 200);
  assert.equal((await f.request('/auth/me', undefined, first.body.token)).status, 200);
});
