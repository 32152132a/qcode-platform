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

test('user options expose active plans and safe models; selected plan restricts the default model on create and edit',async t=>{
 const f=await fixture(t),first=f.db.read().models[0];
 const second=(await f.request('/admin/models','POST',{name:'Other model',publicName:'other-model',upstreamModel:'other',baseUrl:first.base_url,keyId:f.key.id,active:true},f.admin)).body;
 const plan=(await f.request('/admin/plans','POST',{name:'Selected plan',price:0,durationDays:30,level:1,modelIds:[first.id],quotas:{totalTokens:1000}},f.admin)).body;
 const options=(await f.request('/admin/users/options','GET',undefined,f.admin)).body;
 assert.deepEqual(options.plans[0].model_ids,[first.id]);assert(!JSON.stringify(options).includes('secret'));
 const create=body=>f.request('/admin/users','POST',{username:'new-user',password:'Qcode@2026',planId:plan.id,...body},f.admin);
 assert.equal((await create({modelId:second.id})).status,400);
 assert(!f.db.read().users.some(user=>user.username==='new-user'));
 assert.equal((await create({planId:'missing'})).status,400);
 const created=await create({modelId:first.id});assert.equal(created.status,201);assert.equal(created.body.plan_id,plan.id);assert.deepEqual(created.body.plan_model_ids,[first.id]);
 assert.equal((await f.request('/admin/users/'+created.body.id,'PATCH',{modelId:second.id},f.admin)).status,400);
 assert.equal((await f.request('/admin/users/'+created.body.id,'PATCH',{modelId:null},f.admin)).status,200);
});
