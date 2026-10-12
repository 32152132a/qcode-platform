import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareHarnessLaunch} from '../../client/harness-launch.mjs';

test('managed launch preserves personal settings and puts overlay before app flags',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-launch-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  fs.writeFileSync(path.join(home,'cordis.patch.yml'),'personal settings');
  const args=prepareHarnessLaunch({entry:'bin.js',home,baseUrl:'http://127.0.0.1:1234/v1',config:{organizationName:'Team',maxTokensField:'max_tokens',contextWindow:65536,maxOutputTokens:4096},noOpen:true});
  assert.deepEqual(args.slice(1),['web','--patch',path.join(home,'qcode-managed.patch.yml'),'--host','127.0.0.1','--port','0','--no-open']);
  assert.equal(fs.readFileSync(path.join(home,'cordis.patch.yml'),'utf8'),'personal settings');
  const patch=JSON.parse(fs.readFileSync(args[3],'utf8'));
  assert.equal(patch[0].config.providers.qcode.baseURL,'http://127.0.0.1:1234/v1');
  assert.equal(patch[0].config.providers.qcode.apiKeyEnv,'QCODE_TOKEN');
  assert.equal(patch[1].config.provider,'qcode');
  assert.throws(()=>prepareHarnessLaunch({entry:'bin.js',home,mode:'tui',config:{}}),/TUI/);
});

test('TUI launch pins the selected workspace and managed gateway model',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-tui-launch-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const profile=path.join(home,'profiles','qcode-tui');
  fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'package.json'),'{}');
  const workdir=path.join(home,'selected-project');
  const args=prepareHarnessLaunch({entry:'bin.js',mode:'tui',home,workdir,config:{},baseUrl:'http://127.0.0.1:1234/v1'});
  assert.deepEqual(args.slice(1,3),['--profile','qcode-tui']);
  const patch=JSON.parse(fs.readFileSync(args[4],'utf8'));
  assert.deepEqual(patch.find(item=>item.id==='dsh-tui').config,{provider:'qcode',model:'qcode-model',cwd:workdir});
});
