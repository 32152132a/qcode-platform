import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import express from 'express';
import {registerDistribution} from '../src/distribution.js';
import {publishClient} from '../scripts/publish-client.js';

test('employee downloads a complete EXE while updates still receive the ZIP',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-distribution-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'build'),directory=path.join(root,'published');fs.mkdirSync(source);
  const exe=Buffer.from('test executable'),zip=Buffer.from('test update archive');
  const hash=data=>createHash('sha256').update(data).digest('hex');
  const manifest={version:'0.4.0',harnessBrand:'QCode',downloadUrl:'/downloads/qcode-client-0.4.0.zip',sha256:hash(zip),installerUrl:'/downloads/QCodeSetup-0.4.0.exe',installerSha256:hash(exe)};
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(source,'QCodeSetup-0.4.0.exe'),exe);fs.writeFileSync(path.join(source,'qcode-client-0.4.0.zip'),zip);
  const app=express();registerDistribution(app,{directory});app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code}));
  const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/downloads/installer')).status,503);
  publishClient(source,directory);
  const response=await fetch(url+'/downloads/installer');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/QCodeSetup-0.4.0.exe/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),exe);
  const metadata=await fetch(url+'/downloads/manifest.json');assert.equal(metadata.headers.get('cache-control'),'no-store');assert.equal((await metadata.json()).downloadUrl,manifest.downloadUrl);
  const partial=await fetch(url+manifest.installerUrl,{headers:{Range:'bytes=0-3'}});assert.equal(partial.status,206);
  const lock=path.join(directory,'.publish.lock');fs.writeFileSync(lock,'another publisher');
  assert.throws(()=>publishClient(source,directory),/publication is active/);
  assert.equal(fs.readFileSync(lock,'utf8'),'another publisher');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),manifest);
  fs.unlinkSync(lock);
  fs.writeFileSync(path.join(source,'QCodeSetup-0.4.0.exe'),'damaged');
  assert.throws(()=>publishClient(source,directory),/checksum/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),manifest);
  assert.deepEqual(fs.readFileSync(path.join(directory,'QCodeSetup-0.4.0.exe')),exe);
});

test('successful publication retains only the latest Windows files and preserves the Mac namespace',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-retention-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),destination=path.join(root,'releases');
  fs.mkdirSync(source);fs.mkdirSync(destination);
  const hash=data=>createHash('sha256').update(data).digest('hex');
  function build(version){
    const zip=Buffer.from('zip '+version),exe=Buffer.from('exe '+version);
    const manifest={version,harnessBrand:'QCode',platform:'win32',downloadUrl:`/downloads/qcode-client-${version}.zip`,sha256:hash(zip),installerUrl:`/downloads/QCodeSetup-${version}.exe`,installerSha256:hash(exe)};
    fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
    fs.writeFileSync(path.join(source,`qcode-client-${version}.zip`),zip);
    fs.writeFileSync(path.join(source,`QCodeSetup-${version}.exe`),exe);
    return manifest;
  }
  build('1.0.0');publishClient(source,destination);
  fs.writeFileSync(path.join(destination,'macos','QCode-1.0.0.dmg'),'future Mac fixture');
  fs.writeFileSync(path.join(destination,'notes.txt'),'keep');
  const next=build('1.0.1');
  fs.writeFileSync(path.join(source,'QCodeSetup-1.0.1.exe'),'corrupt');
  assert.throws(()=>publishClient(source,destination),/checksum/);
  assert.ok(fs.existsSync(path.join(destination,'QCodeSetup-1.0.0.exe')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'))).version,'1.0.0');
  build('1.0.1');publishClient(source,destination);
  assert.deepEqual(fs.readdirSync(destination).sort(),['QCodeSetup-1.0.1.exe','macos','manifest.json','notes.txt','qcode-client-1.0.1.zip'].sort());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'))),next);
  assert.equal(fs.readFileSync(path.join(destination,'macos','QCode-1.0.0.dmg'),'utf8'),'future Mac fixture');
  assert.equal(fs.readFileSync(path.join(destination,'notes.txt'),'utf8'),'keep');
});
