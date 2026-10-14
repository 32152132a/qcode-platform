import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('old update payload uses the executing installer uninstall pair',{skip:process.platform!=='win32'},async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-old-payload-'));
  try{
    const source=path.join(parent,'old-payload'),root=path.join(parent,'installed');fs.mkdirSync(source);fs.mkdirSync(root);
    const client=fileURLToPath(new URL('../../client/',import.meta.url));
    const text=fs.readFileSync(path.join(client,'install.ps1'),'utf8');
    const start=text.indexOf('    $uninstallSource=$null');const end=text.indexOf('    if(-not $NoPath){',start);
    assert.ok(start>=0&&end>start);
    const script=path.join(parent,'copy-uninstaller.ps1');
    const quoted=value=>"'"+value.replaceAll("'","''")+"'";
    fs.copyFileSync(path.join(client,'uninstall.ps1'),path.join(parent,'uninstall.ps1'));fs.copyFileSync(path.join(client,'uninstall.cmd'),path.join(parent,'uninstall.cmd'));
    fs.writeFileSync(script,`\uFEFF$ErrorActionPreference='Stop'\n$source=${quoted(source)}\n$InstallRoot=${quoted(root)}\n${text.slice(start,end)}`);
    const result=await new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true});
      let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,output}));
    });
    assert.equal(result.code,0,result.output);
    for(const name of ['uninstall.ps1','uninstall.cmd'])assert.deepEqual(fs.readFileSync(path.join(root,name)),fs.readFileSync(path.join(client,name)));
  }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

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
  const wrapper=path.join(root,'test-installer.ps1');
  fs.writeFileSync(wrapper,`param([string]$Installer,[string]$InstallRoot,[string]$Gateway,[switch]$Update,[switch]$Rollback)
function Invoke-WebRequest {
  param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing,[int]$TimeoutSec)
  if(([Uri]$Uri).Host -ne '127.0.0.1'){throw 'External downloads are forbidden in this test'}
  Microsoft.PowerShell.Utility\\Invoke-WebRequest @PSBoundParameters
}
& $Installer -InstallRoot $InstallRoot -Gateway $Gateway -NoPath -Update:$Update -Rollback:$Rollback
`);
  async function install(flags){
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',wrapper,'-Installer',installer,'-InstallRoot',root,'-Gateway',gateway,...flags],{env:{...process.env,QCODE_NODE:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});return {code,output};
  }
  const bad=await install(['-Update']);assert.notEqual(bad.code,0);assert.match(bad.output,/checksum mismatch/);
  assert.deepEqual(fs.readdirSync(path.join(root,'downloads')),[],'failed update cleans its downloaded payload');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,'0.3.0');
  corrupt=false;const good=await install(['-Update']);assert.equal(good.code,0,good.output);
  assert.match(good.output,/Installing the bundled Node/);
  assert.deepEqual(fs.readdirSync(path.join(root,'downloads')),[],'successful update cleans its downloaded payload');
  assert.ok(fs.existsSync(path.join(root,`runtime/node-v24.19.0-win-${manifest.arch}/node.exe`)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,manifest.version);
  assert.ok(fs.existsSync(path.join(root,`versions/${manifest.version}/web-login.html`)),'installed login HTML is required');
  assert.ok(fs.existsSync(path.join(root,`versions/${manifest.version}/branding/qcode-96.png`)),'installed login icon is required');
  assert.ok(fs.existsSync(path.join(root,`versions/${manifest.version}/${manifest.runtime==='opencode'?'opencode/bin/qcode-engine.exe':'harness-custom/lib/bin.js'}`)));
  assert.equal(fs.readFileSync(path.join(root,'saved-session-test'),'utf8'),'preserve me');
  assert.ok(fs.existsSync(path.join(root,'uninstall.ps1')));
  assert.ok(fs.existsSync(path.join(root,'uninstall.cmd')));
  const rollback=await install(['-Rollback']);assert.equal(rollback.code,0,rollback.output);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,'0.3.0');
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
  console.log('Installer test passed; isolated fixture scheduled for cleanup.');
});
