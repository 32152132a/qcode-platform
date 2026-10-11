import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture} from './gateway.test.js';
import {secureStore} from '../../client/session-store.mjs';
import {GatewaySession,startBridge} from '../../client/bridge.mjs';
import {prepareHarnessLaunch} from '../../client/harness-launch.mjs';

test('packaged Web starts through the authenticated employee launcher', {skip:!process.env.QCODE_TEST_HARNESS_ENTRY,timeout:90000},async t=>{
  const f=await fixture(t);await f.create();
  const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-runtime-'));
  const serverRoot=path.join(root,'gateway');fs.mkdirSync(serverRoot);
  const session=path.join(serverRoot,'session.json');secureStore(session).write(login);
  const launcher=fileURLToPath(new URL('../../client/launcher.mjs',import.meta.url));
  const child=spawn(process.execPath,[launcher,'--gateway',f.url,'--session',session,'--entry',process.env.QCODE_TEST_HARNESS_ENTRY,'--mode','web','--no-open','true'],{env:{...process.env,QCODE_SKIP_UPDATE:'1',DSH_TELEMETRY_DISABLED:'1'},stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null){if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});else child.kill();}});
  let output='';
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Web startup timed out: '+output.replace(/token=[^\s]+/g,'token=REDACTED'))),60000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Launcher exited ${code}: ${output}`));});
    child.stderr.on('data',chunk=>{output+=chunk;});
    child.stdout.on('data',chunk=>{output+=chunk;const match=/dsh web: (http:\/\/[^\s]+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  const exchange=await fetch(url,{redirect:'manual'});
  const cookie=exchange.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie,'Harness must exchange its local launch token for a browser cookie');
  const response=await fetch(new URL('/',url),{headers:{cookie}});assert.equal(response.status,200);
  assert.match(await response.text(),/<title>QCode<\/title>/);
  assert.equal(output.includes('Skipping patch'),false);
  const renewed=secureStore(session).read();assert.equal(renewed.user.id,login.user.id);
  // Keep isolated runtime logs for diagnosis; no production credentials are used.
});

test('packaged Harness completes a turn through the authenticated gateway', {skip:!process.env.QCODE_TEST_HARNESS_ENTRY,timeout:60000},async t=>{
  const f=await fixture(t);await f.create();
  const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
  const bridge=await startBridge(new GatewaySession(f.url,login,()=>{}));t.after(()=>bridge.close());
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-turn-'));
  const args=prepareHarnessLaunch({entry:process.env.QCODE_TEST_HARNESS_ENTRY,home:root,config:bridge.configuration,baseUrl:bridge.baseUrl}).slice(0,4);
  args[1]='headless';args.push('Say hello. Do not use any tools.');
  const env={...process.env,DSH_HOME:root,DSH_AGENTS_HOME:path.join(root,'agents'),QCODE_TOKEN:bridge.token,DSH_TELEMETRY_DISABLED:'1'};
  delete env.DEEPSEEK_API_KEY;delete env.OPENAI_API_KEY;
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Harness turn timed out: '+output));},45000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(code,0,output);assert.match(output,/你好/);assert.ok(f.calls()>0);
  assert.equal(f.received().auth,'Bearer secret-provider-key');
});
