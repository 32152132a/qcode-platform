import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('installer bootstrap reports missing or corrupt payloads and retains failure logs',{skip:process.platform!=='win32',timeout:45000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-bootstrap-'));
  const script=path.join(root,'bootstrap.ps1'),installed=path.join(root,'isolated install'),temp=path.join(root,'temp');
  fs.mkdirSync(temp);
  fs.copyFileSync(fileURLToPath(new URL('../../../scripts/installer-bootstrap.ps1',import.meta.url)),script);
  async function run(){
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-NoPath','-InstallRoot',installed],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QCODE_GATEWAY:'',TEMP:temp,TMP:temp}});
    t.after(()=>{if(child.exitCode===null)child.kill();});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.equal(code,1,output);assert.match(output,/QCode installation failed/);assert.match(output,/Setup log:/);
    return output;
  }
  assert.match(await run(),/client.zip is missing/);
  fs.writeFileSync(path.join(root,'gateway.txt'),'https://code.quyongqing.cn');
  fs.writeFileSync(path.join(root,'client.zip'),'corrupt ZIP');
  await run();
  const logs=fs.readdirSync(path.join(installed,'logs'));
  assert.equal(logs.length,2);
  assert.ok(logs.every(file=>fs.readFileSync(path.join(installed,'logs',file),'utf8').includes('QCode installation failed')));
  assert.equal(fs.existsSync(path.join(installed,'current.json')),false);
  assert.deepEqual(fs.readdirSync(temp),[],'failed extraction must clean its temporary directory');
});

test('gateway config precedence and invalid origins',{skip:process.platform!=='win32',timeout:120000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-gateway-')),payload=path.join(root,'payload'),installed=path.join(root,'installed'),temp=path.join(root,'temp');
  fs.mkdirSync(temp);
  fs.mkdirSync(payload);fs.mkdirSync(installed);
  const script=path.join(root,'bootstrap.ps1');
  fs.copyFileSync(fileURLToPath(new URL('../../../scripts/installer-bootstrap.ps1',import.meta.url)),script);
  fs.writeFileSync(path.join(payload,'install.ps1'),"param([string]$Gateway,[string]$InstallRoot,[switch]$NoPath)\nif(-not $NoPath){throw 'Test isolation required'}\n[IO.File]::WriteAllText((Join-Path $InstallRoot 'selected.txt'),$Gateway)\n$global:LASTEXITCODE=0\n");
  const {execFileSync}=await import('node:child_process');
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TEST_PAYLOAD,$env:TEST_ARCHIVE)'],{windowsHide:true,env:{...process.env,TEST_PAYLOAD:payload,TEST_ARCHIVE:path.join(root,'client.zip')}});
  fs.writeFileSync(path.join(root,'gateway.txt'),'https://default.example');
  async function run(environment='',explicit=''){
    return await new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-InstallRoot',installed,...(explicit?['-Gateway',explicit]:[])],{windowsHide:true,env:{...process.env,QCODE_GATEWAY:environment,QCODE_SETUP_NO_PATH:'1',TEMP:temp,TMP:temp}});
      let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.once('error',reject);child.once('exit',code=>resolve({code,output}));
    });
  }
  async function check(expected,environment='',explicit=''){
    const result=await run(environment,explicit);assert.equal(result.code,0,result.output);
    assert.equal(fs.readFileSync(path.join(installed,'selected.txt'),'utf8'),expected);
    assert.deepEqual(fs.readdirSync(temp),[],'successful extraction must clean its temporary directory');
  }
  await check('https://default.example');
  fs.writeFileSync(path.join(installed,'settings.json'),JSON.stringify({gateway:'https://custom.example'}));
  await check('https://custom.example');
  await check('https://environment.example','https://environment.example');
  await check('https://explicit.example','https://environment.example','https://explicit.example');
  for(const invalid of ['https://example.com/api','https://user:secret@example.com','https://example.com/?q=1','https://example.com/#fragment']){
    const result=await run('',invalid);assert.equal(result.code,1,result.output);assert.match(result.output,/origin without credentials/);
  }
});
