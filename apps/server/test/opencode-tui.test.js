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

test('OpenCode TUI default qcode command completes a conversation',{
  skip:!process.env.QCODE_TEST_OPENCODE_ENTRY,
  timeout:90000
},async t=>{
  const platform=fileURLToPath(new URL('../../../',import.meta.url));
  const require=createRequire(path.join(platform,'.stage1-dsh/package.json'));
  const pty=require('node-pty');
  const f=await fixture(t);const user=await f.create();
  const login=(await f.request('/auth/login','POST',{username:'alice',password:'user-password'})).body;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-opencode-tui-'));
  const serverId=createHash('sha256').update(f.url).digest('hex').toUpperCase().slice(0,24);
  const serverRoot=path.join(root,serverId);fs.mkdirSync(serverRoot);
  secureStore(path.join(serverRoot,'session.json')).write(login);
  const terminal=pty.spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(platform,'apps/client/qcode.ps1'),'-Gateway',f.url],{
    name:'xterm-256color',cols:110,rows:36,cwd:root,
    env:{...process.env,QCODE_NODE:process.execPath,QCODE_CLIENT_ROOT:root,QCODE_OPENCODE_ENTRY:process.env.QCODE_TEST_OPENCODE_ENTRY,QCODE_HARNESS_ENTRY:'',QCODE_SKIP_UPDATE:'1',DSH_TELEMETRY_DISABLED:'1',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:''}
  });
  t.after(()=>{try{terminal.kill();}catch{}});
  let output='',sent=false;
  terminal.onData(data=>{
    output+=data;
    if(!sent&&output.includes('Ask anything')){
      sent=true;setTimeout(()=>{terminal.write('Say hello without tools.');setTimeout(()=>terminal.write('\r'),500);},1000);
    }
  });
  const start=Date.now();
  while(Date.now()-start<65000){
    if(f.calls()>0&&output.includes('你好'))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  fs.writeFileSync(path.join(root,'terminal.log'),output);
  console.log('TUI test artifacts: '+root);
  assert.ok(sent,'TUI did not reach input prompt: '+output.slice(-3000));
  assert.ok(f.calls()>0,'No request reached the gateway: '+output.slice(-3000));
  assert.equal(f.received().auth,'Bearer secret-provider-key');
  assert.match(output,/你好/);
  assert.equal(f.received().body.model,'private-model');
  fs.writeFileSync(path.join(root,'tools.json'),JSON.stringify(f.received().body.tools,null,2));
});
