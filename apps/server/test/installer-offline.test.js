import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Extract the real EXE without launching its interactive installer or changing the user's PATH.
test('Windows EXE installs its bundled runtime without installer network access',{
  skip:process.platform!=='win32'||!process.env.QCODE_TEST_RELEASE_DIRECTORY,timeout:240000,
},async t=>{
  const release=process.env.QCODE_TEST_RELEASE_DIRECTORY;
  const manifest=JSON.parse(fs.readFileSync(path.join(release,'manifest.json'),'utf8'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-offline-'));
  const payload=path.join(root,'payload'),installed=path.join(root,'employee install');
  fs.mkdirSync(payload);fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed,'personal-project.txt'),'preserve my project');
  const networkLog=path.join(root,'network.log');
  const script=path.join(root,'offline.ps1');
  fs.writeFileSync(script,`param([string]$Setup,[string]$Payload,[string]$InstallRoot,[string]$NetworkLog)
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
$process=Start-Process -FilePath $Setup -ArgumentList @('/Q','/C',('/T:'+ $Payload)) -WindowStyle Hidden -PassThru
if(-not $process.WaitForExit(60000)){throw 'EXE extraction timed out'}
if($process.ExitCode -ne 0){throw 'EXE extraction failed'}
if(-not (Test-Path -LiteralPath (Join-Path $Payload 'install.cmd'))){throw 'EXE bootstrap missing'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source=Join-Path $Payload 'client'
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $Payload 'client.zip'),$source)
function Invoke-WebRequest { [IO.File]::AppendAllText($NetworkLog,'WebRequest');throw 'Network forbidden during offline install' }
function Invoke-RestMethod { [IO.File]::AppendAllText($NetworkLog,'RestMethod');throw 'Network forbidden during offline install' }
& (Join-Path $source 'install.ps1') -InstallRoot $InstallRoot -Gateway 'http://127.0.0.1:1' -NoPath
if(-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'bin/qcodeweb.cmd'))){throw 'Web command missing'}
& (Join-Path $InstallRoot 'bin/qcode.cmd') help
if($LASTEXITCODE -ne 0){throw 'Installed command failed'}
`);
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
    '-Setup',path.join(release,`QCodeSetup-${manifest.version}.exe`),'-Payload',payload,'-InstallRoot',installed,'-NetworkLog',networkLog],
    {windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QCODE_NODE:'',QCODE_OPENCODE_ENTRY:'',QCODE_HARNESS_ENTRY:''}});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  fs.writeFileSync(path.join(root,'install.log'),output);
  assert.equal(code,0,output);
  assert.equal(fs.existsSync(networkLog),false,'Installer attempted a network request');
  assert.match(output,/Installing the bundled Node/);
  assert.match(output,/default: TUI/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'current.json'))).version,manifest.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,'settings.json'))).gateway,'http://127.0.0.1:1');
  assert.equal(fs.readFileSync(path.join(installed,'personal-project.txt'),'utf8'),'preserve my project');
  assert.ok(fs.existsSync(path.join(installed,`runtime/node-v24.19.0-win-${manifest.arch}/node.exe`)));
  assert.ok(fs.existsSync(path.join(installed,`versions/${manifest.version}/opencode/bin/qcode-engine.exe`)));
  console.log('Offline EXE installation artifacts: '+root);
});
