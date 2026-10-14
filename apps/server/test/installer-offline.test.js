import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';

test('Windows EXE runs its packaged install command and installs the client runtime',{
  skip:process.platform!=='win32'||!process.env.QCODE_TEST_RELEASE_DIRECTORY,timeout:600000,
},async t=>{
  const release=process.env.QCODE_TEST_RELEASE_DIRECTORY;
  const manifest=JSON.parse(fs.readFileSync(path.join(release,'manifest.json'),'utf8'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-offline-'));
  const installed=path.join(root,'employee install');
  const appId=manifest.installerTestAppId||'{A868EA29-3EDC-4FD4-98C0-5C9731645612}';
  assert.match(appId,/^(?:QCodeTest-[a-f0-9]{32}|\{A868EA29-3EDC-4FD4-98C0-5C9731645612\})$/);
  const registry='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+appId+'_is1';
  function registeredLocation(){
    return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); (Get-ItemProperty -LiteralPath '${registry}' -ErrorAction SilentlyContinue).InstallLocation`],{windowsHide:true,encoding:'utf8'}).trim();
  }
  assert.equal(registeredLocation(),'','Do not replace an existing real QCode Inno registration during testing');
  t.after(async()=>{
    if(registeredLocation().replace(/[\\/]$/,'')===installed){
      const link=path.join(installed,'unsafe-link');if(fs.existsSync(link))fs.unlinkSync(link);
      await execute(path.join(installed,'.setup','unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART']);
    }
  });
  fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed,'personal-project.txt'),'preserve my project');
  // Simulate the owned layout left by a pre-Inno installer.
  const legacy=path.join(installed,'versions','0.3.0');fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'qcode.ps1'),"Write-Output 'legacy'");
  fs.writeFileSync(path.join(legacy,'.qcode-release.json'),JSON.stringify({version:'0.3.0'}));
  fs.writeFileSync(path.join(installed,'current.json'),JSON.stringify({version:'0.3.0'}));
  const configuredGateway=fs.readFileSync(path.join(release,'exe-build/gateway.txt'),'utf8').trim();
  const child=spawn(path.join(release,`QCodeSetup-${manifest.version}.exe`),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',`/DIR=${installed}`],{
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
  if(child.exitCode===null)await once(child,'exit');
  assert.equal(child.exitCode,0);
  assert.ok(fs.existsSync(path.join(installed,'.setup','unins000.exe')));
  assert.equal(registeredLocation().replace(/[\\/]$/,''),installed);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'current.json'))).version,manifest.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'current.json'))).previous,'0.3.0');
  assert.ok(fs.existsSync(path.join(legacy,'qcode.ps1')));
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
  async function execute(program,args){
    const childProcess=spawn(program,args,{windowsHide:true,stdio:'ignore',env:{...process.env,QCODE_SETUP_NO_PATH:'1',QCODE_GATEWAY:'',QCODE_CLIENT_ROOT:installed}});
    return await new Promise((resolve,reject)=>{childProcess.once('error',reject);childProcess.once('exit',resolve);});
  }
  const gatewayData=path.join(installed,'0123456789abcdef01234567');
  const user=path.join(gatewayData,'users','abcdef0123456789abcdef0123456789');
  fs.mkdirSync(path.join(user,'opencode','config'),{recursive:true});fs.mkdirSync(path.join(user,'workspace'),{recursive:true});
  fs.writeFileSync(path.join(gatewayData,'session.json'),'encrypted-test-token');
  fs.writeFileSync(path.join(user,'opencode','config','auth.json'),'private-config');fs.writeFileSync(path.join(user,'workspace','project.txt'),'project');
  const native=path.join(installed,'.setup','unins000.exe');
  // The registered uninstaller must abort without unregistering on an unsafe link.
  const outside=path.join(root,'external-project');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'keep');
  fs.symlinkSync(outside,path.join(installed,'unsafe-link'),'junction');
  assert.notEqual(await execute(native,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART']),0);
  assert.equal(registeredLocation().replace(/[\\/]$/,''),installed);
  fs.unlinkSync(path.join(installed,'unsafe-link'));
  assert.equal(await execute(native,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART']),0);
  assert.equal(registeredLocation(),'');assert.equal(fs.existsSync(path.join(installed,'runtime')),false);
  assert.equal(fs.readFileSync(path.join(gatewayData,'session.json'),'utf8'),'encrypted-test-token');
  assert.equal(await execute(path.join(release,`QCodeSetup-${manifest.version}.exe`),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',`/DIR=${installed}`]),0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'settings.json'))).gateway,customGateway);
  assert.equal(await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(installed,'uninstall.ps1'),'-InstallRoot',installed,'-NonInteractive','-RemoveAllData','-ConfirmAllData','删除全部 QCode 本地数据']),0);
  assert.equal(registeredLocation(),'');assert.equal(fs.existsSync(path.join(gatewayData,'session.json')),false);
  assert.equal(fs.existsSync(path.join(user,'opencode')),false);assert.equal(fs.readFileSync(path.join(user,'workspace','project.txt'),'utf8'),'project');
  assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'keep');
  console.log('Offline EXE installation artifacts: '+root);
});
