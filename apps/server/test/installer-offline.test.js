import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('Windows EXE runs its packaged install command and installs the client runtime',{
  skip:process.platform!=='win32'||!process.env.QCODE_TEST_RELEASE_DIRECTORY,timeout:600000,
},async t=>{
  const release=process.env.QCODE_TEST_RELEASE_DIRECTORY;
  const manifest=JSON.parse(fs.readFileSync(path.join(release,'manifest.json'),'utf8'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-offline-'));
  const installed=path.join(root,'employee install');
  fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed,'personal-project.txt'),'preserve my project');
  const configuredGateway=fs.readFileSync(path.join(release,'exe-build/gateway.txt'),'utf8').trim();
  const child=spawn(path.join(release,`QCodeSetup-${manifest.version}.exe`),['/Q:A','/R:N'],{
    windowsHide:true,stdio:'ignore',env:{...process.env,QCODE_CLIENT_ROOT:installed,QCODE_SETUP_NO_PAUSE:'1',QCODE_SETUP_NO_PATH:'1',QCODE_GATEWAY:'',QCODE_NODE:'',QCODE_OPENCODE_ENTRY:'',QCODE_HARNESS_ENTRY:''}});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await new Promise((resolve,reject)=>{
    child.once('error',reject);
    const deadline=Date.now()+540000;
    const poll=setInterval(()=>{
      const logsDirectory=path.join(installed,'logs');
      const setupLog=fs.existsSync(logsDirectory)&&fs.readdirSync(logsDirectory).find(name=>name.endsWith('.log'));
      const log=setupLog?fs.readFileSync(path.join(logsDirectory,setupLog),'utf8'):'';
      if(/QCode installation succeeded/.test(log)){clearInterval(poll);resolve();}
      else if(/QCode installation failed/.test(log)){clearInterval(poll);reject(new Error(log));}
      else if(child.exitCode!==null&&child.exitCode!==0){clearInterval(poll);reject(new Error(`Setup EXE exited before installation completed (${child.exitCode})`));}
      else if(Date.now()>deadline){clearInterval(poll);reject(new Error('Setup EXE did not complete installation within 9 minutes'));}
    },500);
  });
  const setupLogs=fs.readdirSync(path.join(installed,'logs')).filter(name=>name.endsWith('.log'));
  assert.ok(setupLogs.length>0,'Packaged install command did not launch the bootstrap');
  const setupLog=fs.readFileSync(path.join(installed,'logs',setupLogs.at(-1)),'utf8');
  assert.match(setupLog,/QCode setup is starting/);
  assert.match(setupLog,/QCode installation succeeded/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'current.json'))).version,manifest.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'settings.json'))).gateway,configuredGateway);
  assert.equal(fs.readFileSync(path.join(installed,'personal-project.txt'),'utf8'),'preserve my project');
  assert.ok(fs.existsSync(path.join(installed,`runtime/node-v24.19.0-win-${manifest.arch}/node.exe`)));
  const runtimeEntry=manifest.runtime==='opencode'?'opencode/bin/qcode-engine.exe':'harness-custom/lib/bin.js';
  assert.ok(fs.existsSync(path.join(installed,`versions/${manifest.version}/${runtimeEntry}`)));
  const gatewayServer=http.createServer((request,response)=>{
    if(request.url==='/health')return response.setHeader('Content-Type','application/json').end('{"status":"ok"}');
    response.writeHead(404).end();
  });
  gatewayServer.listen(0,'127.0.0.1');await once(gatewayServer,'listening');
  t.after(()=>{gatewayServer.closeAllConnections();gatewayServer.close();});
  const customGateway=`http://127.0.0.1:${gatewayServer.address().port}`;
  fs.writeFileSync(path.join(installed,'settings.json'),JSON.stringify({gateway:customGateway}));
  const reinstall=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(release,'exe-build/bootstrap.ps1'),'-InstallRoot',installed,'-NoPath'],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QCODE_GATEWAY:'',QCODE_NODE:'',QCODE_OPENCODE_ENTRY:'',QCODE_HARNESS_ENTRY:''}});
  t.after(()=>{if(reinstall.exitCode===null)reinstall.kill();});
  let reinstallOutput='';reinstall.stdout.on('data',chunk=>reinstallOutput+=chunk);reinstall.stderr.on('data',chunk=>reinstallOutput+=chunk);
  const reinstallCode=await new Promise((resolve,reject)=>{reinstall.once('error',reject);reinstall.once('exit',resolve);});
  assert.equal(reinstallCode,0,reinstallOutput);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'settings.json'))).gateway,customGateway);
  console.log('Offline EXE installation artifacts: '+root);
});
