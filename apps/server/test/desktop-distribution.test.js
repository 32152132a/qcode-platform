import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import {publishDesktop} from '../scripts/publish-desktop.js';
import {registerDistribution} from '../src/distribution.js';

function release(root,version){
  const directory=path.join(root,'source-'+version);fs.mkdirSync(directory);
  const installer='QCodeDesktopSetup-'+version+'.exe';
  const names=[installer,installer+'.blockmap','latest.yml'];
  for(const name of names)fs.writeFileSync(path.join(directory,name),version+' fixture '+name);
  const manifest={product:'QCodeDesktop',version,installer,files:names.map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')}))};
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
  return {directory,manifest};
}
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-desktop-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('desktop publisher validates checksums and retains only the latest desktop artifacts',t=>{
  const root=temporary(t),destination=path.join(root,'releases');
  fs.mkdirSync(path.join(destination,'macos'),{recursive:true});
  fs.writeFileSync(path.join(destination,'manifest.json'),'legacy');
  fs.writeFileSync(path.join(destination,'macos','keep.txt'),'mac');
  const first=release(root,'0.5.0');publishDesktop(first.directory,destination);
  const second=release(root,'0.5.1');publishDesktop(second.directory,destination);
  assert(!fs.existsSync(path.join(destination,'desktop',first.manifest.installer)));
  assert(fs.existsSync(path.join(destination,'desktop',second.manifest.installer)));
  assert.equal(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'),'legacy');
  assert.equal(fs.readFileSync(path.join(destination,'macos','keep.txt'),'utf8'),'mac');
});

test('bad artifacts do not replace the active desktop release',t=>{
  const root=temporary(t),destination=path.join(root,'releases');
  const first=release(root,'0.5.0');publishDesktop(first.directory,destination);
  const bad=release(root,'0.5.1');fs.appendFileSync(path.join(bad.directory,bad.manifest.installer),'corrupt');
  assert.throws(()=>publishDesktop(bad.directory,destination),/checksum/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'desktop/manifest.json'))).version,'0.5.0');
});

test('desktop downloads and updates share the published namespace without serving arbitrary files',async t=>{
  const root=temporary(t),destination=path.join(root,'releases');
  const first=release(root,'0.5.0');publishDesktop(first.directory,destination);
  const app=express();registerDistribution(app,{directory:destination});app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.code}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url='http://127.0.0.1:'+server.address().port;
  const installer=await fetch(url+'/downloads/installer');
  assert.equal(installer.status,200);assert.match(installer.headers.get('content-disposition'),/QCodeDesktopSetup-0.5.0.exe/);
  assert.equal((await fetch(url+'/downloads/desktop/latest.yml')).status,200);
  assert.equal((await fetch(url+'/downloads/desktop/manifest.json')).status,200);
  assert.equal((await fetch(url+'/downloads/desktop/secrets.env')).status,404);
});
