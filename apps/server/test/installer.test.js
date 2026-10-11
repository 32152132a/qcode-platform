import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('custom runtime update validates checksum and rollback preserves user data',{skip:!process.env.QCODE_TEST_RELEASE_DIRECTORY,timeout:240000},async t=>{
  const release=process.env.QCODE_TEST_RELEASE_DIRECTORY;
  const manifest=JSON.parse(fs.readFileSync(path.join(release,'manifest.json'),'utf8'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-install-'));
  fs.mkdirSync(path.join(root,'versions/0.3.0'),{recursive:true});
  fs.writeFileSync(path.join(root,'versions/0.3.0/qcode.ps1'),"Write-Output 'previous release'");
  fs.writeFileSync(path.join(root,'current.json'),JSON.stringify({version:'0.3.0'}));
  fs.writeFileSync(path.join(root,'saved-session-test'),'preserve me');
  let corrupt=true;
  const server=http.createServer((req,res)=>{
    if(req.url==='/health')return res.setHeader('Content-Type','application/json').end('{"status":"ok"}');
    if(req.url==='/downloads/manifest.json')return res.setHeader('Content-Type','application/json').end(JSON.stringify({...manifest,sha256:corrupt?'0'.repeat(64):manifest.sha256}));
    if(req.url===manifest.downloadUrl){res.setHeader('Content-Length',manifest.size);return fs.createReadStream(path.join(release,path.basename(manifest.downloadUrl))).pipe(res);}
    res.writeHead(404).end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const gateway=`http://127.0.0.1:${server.address().port}`;
  const installer=fileURLToPath(new URL('../../client/install.ps1',import.meta.url));
  async function install(flags){
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',installer,'-InstallRoot',root,'-Gateway',gateway,'-SkipRuntime','-NoPath',...flags],{env:{...process.env,QCODE_NODE:process.execPath},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});return {code,output};
  }
  const bad=await install(['-Update']);assert.notEqual(bad.code,0);assert.match(bad.output,/checksum mismatch/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,'0.3.0');
  corrupt=false;const good=await install(['-Update']);assert.equal(good.code,0,good.output);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,'0.4.0');
  assert.ok(fs.existsSync(path.join(root,'versions/0.4.0/harness-custom/lib/bin.js')));
  assert.equal(fs.readFileSync(path.join(root,'saved-session-test'),'utf8'),'preserve me');
  const rollback=await install(['-Rollback']);assert.equal(rollback.code,0,rollback.output);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,'0.3.0');
  console.log('Installer test location: '+root);
});
