import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './gateway.test.js';
import { GatewaySession, startBridge } from '../../client/bridge.mjs';
import { syncSkills } from '../../client/skills.mjs';
import { newerVersion } from '../../client/update.mjs';

test('client bridge protects loopback, renews expired sessions and forwards SSE',async t=>{
  const f=await fixture(t);const user=await f.create();
  const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
  let saves=0;
  const session=new GatewaySession(f.url,login,()=>{saves++;});
  const bridge=await startBridge(session);t.after(()=>bridge.close());
  assert.equal((await fetch(bridge.baseUrl+'/models')).status,401);
  assert.equal((await fetch(bridge.baseUrl+'/models',{headers:{Authorization:`Bearer ${bridge.token}`,Origin:'https://evil.example'}})).status,403);
  f.db.transaction(s=>{s.tokens.find(t=>t.user_id===user.id).expires_at='2000-01-01';});
  const response=await fetch(bridge.baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'local-alias',messages:[{role:'user',content:'hello'}],max_tokens:10,stream:true})});
  assert.equal(response.status,200);assert.match(await response.text(),/你好/);assert.equal(saves,1);
  assert.notEqual(session.session.token,login.token);assert.equal(f.calls(),1);
});

test('client refresh is single-flight and never replays an upstream failure',async t=>{
  const f=await fixture(t);await f.create();
  const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
  login.expiresAt='2000-01-01';let saves=0;
  const session=new GatewaySession(f.url,login,()=>{saves++;});
  await Promise.all([session.renew(),session.renew(),session.renew()]);assert.equal(saves,1);
  const bridge=await startBridge(session);t.after(()=>bridge.close());
  const response=await fetch(bridge.baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'qcode-model',messages:[{}],max_tokens:10,testCase:'failure'})});
  assert.equal(response.status,502);await response.text();assert.equal(f.calls(),1);
});

test('managed skills update atomically and remove only managed directories',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-skills-'));
  try{
    const files={'SKILL.md':'---\nname: demo\ndescription: Demo\n---\nHello','references/rules.md':'Rules'};
    const skill={id:'a'.repeat(32),name:'demo',files,revision:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
    await syncSkills(home,[skill]);
    const root=path.join(home,'skills');fs.mkdirSync(path.join(root,'personal'));fs.writeFileSync(path.join(root,'personal','SKILL.md'),'mine');
    assert.equal(fs.readFileSync(path.join(root,'qcode-'+skill.id,'references','rules.md'),'utf8'),'Rules');
    await syncSkills(home,[skill]);await syncSkills(home,[]);
    assert.equal(fs.existsSync(path.join(root,'qcode-'+skill.id)),false);assert.equal(fs.existsSync(path.join(root,'personal','SKILL.md')),true);
    const unsafe={...skill,files:{'SKILL.md':'test','../escape':'bad'}};unsafe.revision=createHash('sha256').update(JSON.stringify(unsafe.files)).digest('hex');
    await assert.rejects(syncSkills(home,[unsafe]),/不安全/);
    await assert.rejects(syncSkills(home,[{...skill,revision:'bad'}]),/校验/);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('release comparison does not downgrade or compare versions lexicographically',()=>{
  assert.equal(newerVersion('0.10.0','0.3.0'),true);assert.equal(newerVersion('0.3.0','0.3.0'),false);assert.equal(newerVersion('0.2.9','0.3.0'),false);
});
