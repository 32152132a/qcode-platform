import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('installer bootstrap reports missing or corrupt payloads and retains failure logs',{skip:process.platform!=='win32',timeout:45000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-bootstrap-'));
  const script=path.join(root,'bootstrap.ps1'),installed=path.join(root,'isolated install');
  fs.copyFileSync(fileURLToPath(new URL('../../../scripts/installer-bootstrap.ps1',import.meta.url)),script);
  async function run(){
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-NoPath','-InstallRoot',installed],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    t.after(()=>{if(child.exitCode===null)child.kill();});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.equal(code,1,output);assert.match(output,/QCode installation failed/);assert.match(output,/Setup log:/);
    return output;
  }
  assert.match(await run(),/client.zip is missing/);
  fs.writeFileSync(path.join(root,'client.zip'),'corrupt ZIP');
  await run();
  const logs=fs.readdirSync(path.join(installed,'logs'));
  assert.equal(logs.length,2);
  assert.ok(logs.every(file=>fs.readFileSync(path.join(installed,'logs',file),'utf8').includes('QCode installation failed')));
  assert.equal(fs.existsSync(path.join(installed,'current.json')),false);
});
