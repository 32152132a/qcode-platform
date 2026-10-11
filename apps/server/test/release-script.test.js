import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows release command uploads before activation and stops on preflight or transfer failure',{skip:process.platform!=='win32'},async t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-release-command-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const log=path.join(temporary,'calls.jsonl');
  const release=path.join(temporary,'release');fs.mkdirSync(release);
  const zip=Buffer.from('fixture zip'),exe=Buffer.from('fixture exe');
  const hash=data=>createHash('sha256').update(data).digest('hex');
  fs.writeFileSync(path.join(release,'qcode-client-1.2.3.zip'),zip);
  fs.writeFileSync(path.join(release,'QCodeSetup-1.2.3.exe'),exe);
  fs.writeFileSync(path.join(release,'manifest.json'),JSON.stringify({version:'1.2.3',harnessBrand:'QCode',sha256:hash(zip),installerSha256:hash(exe),downloadUrl:'/downloads/qcode-client-1.2.3.zip',installerUrl:'/downloads/QCodeSetup-1.2.3.exe'}));
  const key=path.join(temporary,'fake.pem');fs.writeFileSync(key,'test fixture, not a credential');
  fs.writeFileSync(path.join(temporary,'remote.cjs'),`
    const fs=require('node:fs');
    const args=process.argv.slice(2);fs.appendFileSync(process.env.QCODE_RELEASE_TEST_LOG,JSON.stringify(args)+'\\n');
    if(args[0]==='scp'&&process.env.QCODE_RELEASE_TEST_MODE==='upload-fail')process.exit(1);
    if(args.at(-1).startsWith('docker inspect '))console.log(JSON.stringify([{State:{Running:true},Mounts:process.env.QCODE_RELEASE_TEST_MODE==='missing-mount'?[]:[{Type:'volume',RW:true,Destination:'/app/apps/server/releases'}]}]));
  `);
  for(const tool of ['ssh','scp'])fs.writeFileSync(path.join(temporary,tool+'.cmd'),`@echo off\r\nnode "%~dp0remote.cjs" ${tool} %*\r\n`);
  const script=fileURLToPath(new URL('../../../scripts/release-client.ps1',import.meta.url));
  async function run(mode,target='tester@example.invalid'){
    fs.writeFileSync(log,'');
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-PublishDirectory',release,'-Target',target,'-SshKey',key],{windowsHide:true,env:{...process.env,PATH:temporary+path.delimiter+path.dirname(process.execPath)+path.delimiter+process.env.PATH,QCODE_RELEASE_TEST_LOG:log,QCODE_RELEASE_TEST_MODE:mode}});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
    return {code,output,calls:fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};
  }
  const success=await run('success');assert.equal(success.code,0,success.output);
  const publication=success.calls.findIndex(args=>args.at(-1).includes('node /app/apps/server/scripts/publish-client.js'));
  assert.ok(publication>0);
  assert.equal(success.calls.filter(args=>args[0]==='scp').length,3);
  assert.equal(success.calls.slice(0,publication).filter(args=>args.at(-1).startsWith('docker cp ')).length,3);
  assert.ok(success.calls.every(args=>!args.at(-1).match(/restart|compose|git pull/)));
  const failed=await run('upload-fail');assert.notEqual(failed.code,0);
  assert.ok(!failed.calls.some(args=>args.at(-1).includes('node /app/apps/server/scripts/publish-client.js')));
  const unmounted=await run('missing-mount');assert.notEqual(unmounted.code,0);assert.equal(unmounted.calls.length,1);
  const injection=await run('success','tester@example.invalid;echo');assert.notEqual(injection.code,0);assert.equal(injection.calls.length,0);
  fs.appendFileSync(path.join(release,'QCodeSetup-1.2.3.exe'),'corrupt');
  const corrupt=await run('success');assert.notEqual(corrupt.code,0);assert.equal(corrupt.calls.length,0);
});
