import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {fixture} from './gateway.test.js';
import {secureStore} from '../../client/session-store.mjs';

test('qcodeweb command starts an authenticated local Web service',{
  skip:!process.env.QCODE_TEST_OPENCODE_ENTRY,
  timeout:90000
},async t=>{
  const platform=fileURLToPath(new URL('../../../',import.meta.url));
  const require=createRequire(path.join(platform,'.stage1-dsh/package.json'));
  const pty=require('node-pty');
  const f=await fixture(t);const user=await f.create();
  const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-web-command-'));
  const serverId=createHash('sha256').update(f.url).digest('hex').toUpperCase().slice(0,24);
  const serverRoot=path.join(root,serverId);fs.mkdirSync(serverRoot);
  secureStore(path.join(serverRoot,'session.json')).write(login);
  const terminal=pty.spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command','& $env:QCODE_TEST_WEB_COMMAND -Gateway $env:QCODE_GATEWAY -NoOpen'],{
    name:'xterm-256color',cols:220,rows:36,cwd:root,
    env:{...process.env,QCODE_NODE:process.execPath,QCODE_TEST_WEB_COMMAND:path.join(platform,'apps/client/qcodeweb.cmd'),QCODE_GATEWAY:f.url,QCODE_CLIENT_ROOT:root,QCODE_OPENCODE_ENTRY:process.env.QCODE_TEST_OPENCODE_ENTRY,QCODE_HARNESS_ENTRY:'',QCODE_SKIP_UPDATE:'1',DSH_TELEMETRY_DISABLED:'1',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''}
  });
  t.after(()=>{try{terminal.kill();}catch{}});
  let output = '';
  terminal.onData(data => { output += data; });
  const start = Date.now(); let match;
  while (Date.now() - start < 45000) {
    match = output.match(/QCode Web: (http:\/\/127\.0\.0\.1:\d+\/_qcode\/start#[A-Za-z0-9_-]+)/);
    if (match) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  fs.writeFileSync(path.join(root, 'terminal.log'), output);
  assert.ok(match, output.slice(-3000));
  const url = new URL(match[1]);
  assert.equal((await fetch(url.origin + '/session')).status, 401);
  const auth = await fetch(url.origin + '/_qcode/login', { method: 'POST', headers: { Origin: url.origin }, body: url.hash.slice(1) });
  assert.equal(auth.status, 204);
  const health = await fetch(url.origin + '/global/health', { headers: { Cookie: auth.headers.get('set-cookie').split(';')[0] } });
  assert.equal(health.status, 200); assert.equal((await health.json()).healthy, true);
  assert.doesNotMatch(output, /secret-provider-key/);
  console.log('qcodeweb command artifacts: ' + root);
});
