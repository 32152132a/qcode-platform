import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './gateway.test.js';

test('self password change validates current password in Chinese and revokes every login; administrator can reset it',async t=>{
 const f=await fixture(t);const user=await f.create('alice',{sessionLimit:3});const first=await f.login(),second=await f.login();
 const change=body=>f.request('/auth/password','POST',body,first);
 let result=await change({currentPassword:'wrong',password:'new-password-123'});
 assert.equal(result.status,400);assert.match(result.body.error.message,/当前密码不正确/);
 result=await change({currentPassword:'user-password',password:'123'});
 assert.equal(result.status,400);assert.match(result.body.error.message,/密码须为 10/);
 assert.equal((await f.chat(second)).status,200);
 result=await change({currentPassword:'user-password',password:'new-password-123'});
 assert.equal(result.body.loginRequired,true);
 assert.equal((await f.chat(first)).status,401);assert.equal((await f.chat(second)).status,401);
 assert.equal((await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).status,401);
 const login=await f.request('/auth/login','POST',{username:'alice',password:'new-password-123'});assert.equal(login.status,200);
 assert.equal((await f.request('/admin/users/'+user.id+'/password','POST',{password:'bad'},f.admin)).status,400);
 assert.equal((await f.request('/admin/users/'+user.id+'/password','POST',{password:'Qcode@2026'},f.admin)).status,200);
 assert.equal((await f.chat(login.body.token)).status,401);
 assert.equal((await f.request('/auth/login','POST',{username:'alice',password:'Qcode@2026'})).status,200);
});

test('user options list plans without server-selected default models',async t=>{
 const f=await fixture(t),first=f.db.read().models[0];
 const plan=(await f.request('/admin/plans','POST',{name:'Selected plan',price:0,durationDays:30,level:1,modelIds:[first.id],creditAmount:5},f.admin)).body;
 const options=(await f.request('/admin/users/options','GET',undefined,f.admin)).body;
 assert.deepEqual(options,{plans:[{id:plan.id,name:plan.name}]});
 const created=await f.request('/admin/users','POST',{username:'new-user',password:'Qcode@2026',planId:plan.id},f.admin);
 assert.equal(created.status,201);assert.equal(created.body.plan_id,plan.id);
 assert(!Object.hasOwn(created.body,'model_id'));assert(!Object.hasOwn(created.body,'max_concurrent_requests'));
 assert(!Object.hasOwn(f.db.read().users.at(-1),'model_id'));
 const login=await f.request('/auth/login','POST',{username:'new-user',password:'Qcode@2026'});assert.equal(login.status,200);
 const config=(await f.request('/client/config','GET',undefined,login.body.token)).body;
 assert(!Object.hasOwn(config,'model'));
});
