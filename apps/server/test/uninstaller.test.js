import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const uninstaller=fileURLToPath(new URL('../../client/uninstall.ps1',import.meta.url));
function run(root,...args){
  return new Promise(resolve=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',uninstaller,'-InstallRoot',root,'-NonInteractive',...args],{windowsHide:true});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    child.on('close',code=>resolve({code,output}));
  });
}
function fixture(root){
  fs.mkdirSync(path.join(root,'versions','1.0.0'),{recursive:true});
  fs.writeFileSync(path.join(root,'versions','1.0.0','.qcode-release.json'),JSON.stringify({version:'1.0.0'}));
  fs.mkdirSync(path.join(root,'runtime','private-node'),{recursive:true});
  fs.mkdirSync(path.join(root,'downloads','cache'),{recursive:true});
  fs.mkdirSync(path.join(root,'bin'),{recursive:true});
  fs.mkdirSync(path.join(root,'0123456789abcdef01234567'),{recursive:true});
  fs.writeFileSync(path.join(root,'.qcode-install.json'),JSON.stringify({product:'QCode',scope:'CurrentUser'}));
  fs.writeFileSync(path.join(root,'settings.json'),'{}');
  fs.writeFileSync(path.join(root,'0123456789abcdef01234567','session.json'),'encrypted-token');
  fs.writeFileSync(path.join(root,'0123456789abcdef01234567','web-launch.json'),'encrypted-local-link');
  fs.copyFileSync(uninstaller,path.join(root,'uninstall.ps1'));
  fs.writeFileSync(path.join(root,'uninstall.cmd'),'rem entry');
}
async function waitForRemoval(target){
  for(let attempt=0;attempt<50&&fs.existsSync(target);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
}

test('default and custom QCode directories uninstall safely and repeatedly',{skip:process.platform!=='win32'},async t=>{
  for(const name of ['QCode','custom-location']){
    await t.test(name,async()=>{
      const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-uninstall-'));
      const root=path.join(parent,name);const project=path.join(parent,'user-project');
      fixture(root);fs.mkdirSync(project);fs.writeFileSync(path.join(project,'keep.txt'),'keep');
      fs.writeFileSync(path.join(root,'0123456789abcdef01234567','history.json'),'history');
      const first=await run(root);assert.equal(first.code,0,first.output);
      assert.equal(fs.existsSync(path.join(root,'versions')),false);
      assert.equal(fs.existsSync(path.join(root,'runtime')),false);
      assert.equal(fs.readFileSync(path.join(root,'settings.json'),'utf8'),'{}');
      assert.equal(fs.existsSync(path.join(root,'0123456789abcdef01234567','session.json')),false);
      assert.equal(fs.existsSync(path.join(root,'0123456789abcdef01234567','web-launch.json')),false);
      assert.equal(fs.readFileSync(path.join(root,'0123456789abcdef01234567','history.json'),'utf8'),'history');
      assert.equal(fs.readFileSync(path.join(project,'keep.txt'),'utf8'),'keep');
      const repeated=await run(root);assert.equal(repeated.code,0,repeated.output);
      fs.rmSync(parent,{recursive:true,force:true});
    });
  }
});

test('default LOCALAPPDATA location works without an explicit install root',{skip:process.platform!=='win32'},async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-default-'));const root=path.join(parent,'QCode');fixture(root);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',uninstaller,'-NonInteractive'],{windowsHide:true,env:{...process.env,LOCALAPPDATA:parent,QCODE_CLIENT_ROOT:''}});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);assert.equal(fs.existsSync(path.join(root,'runtime')),false);assert.ok(fs.existsSync(path.join(root,'settings.json')));
  fs.rmSync(parent,{recursive:true,force:true});
});

test('all-data removal requires the exact phrase and removes encrypted login data',{skip:process.platform!=='win32'},async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-uninstall-all-'));const root=path.join(parent,'QCode');fixture(root);
  const refused=await run(root,'-RemoveAllData','-ConfirmAllData','wrong');assert.equal(refused.code,1,refused.output);assert.ok(fs.existsSync(root));
  const accepted=await run(root,'-RemoveAllData','-ConfirmAllData','删除全部 QCode 本地数据');assert.equal(accepted.code,0,accepted.output);
  await waitForRemoval(root);assert.equal(fs.existsSync(root),false);
  fs.rmSync(parent,{recursive:true,force:true});
});

test('uninstaller rejects an unmarked directory',{skip:process.platform!=='win32'},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'not-qcode-'));fs.writeFileSync(path.join(root,'keep.txt'),'keep');
  const result=await run(root);assert.equal(result.code,1,result.output);assert.equal(fs.readFileSync(path.join(root,'keep.txt'),'utf8'),'keep');
  fs.rmSync(root,{recursive:true,force:true});
});

test('complete cleanup preserves projects inside the QCode data tree',{skip:process.platform!=='win32'},async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-project-safe-'));const root=path.join(parent,'自定义 QCode');fixture(root);
  const userId='abcdef0123456789abcdef0123456789';
  const workspace=path.join(root,'0123456789abcdef01234567','users',userId,'workspace');fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'project.txt'),'user code');
  const config=path.join(root,'0123456789abcdef01234567','users',userId,'opencode','config');fs.mkdirSync(config,{recursive:true});fs.writeFileSync(path.join(config,'auth.json'),'token');
  const result=await run(root,'-RemoveAllData','-ConfirmAllData','删除全部 QCode 本地数据');assert.equal(result.code,0,result.output);
  assert.equal(fs.readFileSync(path.join(workspace,'project.txt'),'utf8'),'user code');assert.equal(fs.existsSync(config),false);
  assert.equal(fs.existsSync(path.join(root,'0123456789abcdef01234567','session.json')),false);
  fs.rmSync(parent,{recursive:true,force:true});
});

test('junctions are rejected before deletion and retain an error log',{skip:process.platform!=='win32'},async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-junction-safe-'));const root=path.join(parent,'QCode');fixture(root);
  const external=path.join(parent,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'keep.txt'),'keep');
  fs.symlinkSync(external,path.join(root,'runtime','linked'),'junction');
  const result=await run(root);assert.equal(result.code,1,result.output);assert.equal(fs.readFileSync(path.join(external,'keep.txt'),'utf8'),'keep');
  assert.ok(fs.existsSync(path.join(root,'versions')));
  const logs=path.join(process.env.LOCALAPPDATA,'QCode-uninstall-logs');assert.ok(fs.readdirSync(logs).some(name=>fs.readFileSync(path.join(logs,name),'utf8').includes(root)));
  fs.unlinkSync(path.join(root,'runtime','linked'));fs.rmSync(parent,{recursive:true,force:true});
});

test('legacy release ownership permits safe default uninstall',{skip:process.platform!=='win32'},async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-legacy-'));const root=path.join(parent,'QCode');fixture(root);
  fs.unlinkSync(path.join(root,'.qcode-install.json'));fs.writeFileSync(path.join(root,'current.json'),JSON.stringify({version:'1.0.0'}));fs.writeFileSync(path.join(root,'versions','1.0.0','qcode.ps1'),'legacy');
  const result=await run(root);assert.equal(result.code,0,result.output);assert.ok(fs.existsSync(path.join(root,'settings.json')));
  fs.rmSync(parent,{recursive:true,force:true});
});
