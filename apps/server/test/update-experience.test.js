import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {installUpdate} from '../../client/update.mjs';

test('updates expose Chinese stages, retain raw diagnostics in logs and report failures',{skip:process.platform!=='win32'},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-update-ui-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'current.json'),'{"version":"1.0.0"}');
  const server=http.createServer((req,res)=>res.writeHead(200,{'Content-Type':'application/json'}).end('{"version":"1.0.1","runtime":"opencode"}'));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const gateway=`http://127.0.0.1:${server.address().port}`,installer=path.join(root,'fake-install.ps1');
  fs.writeFileSync(installer,"param($Gateway,[switch]$Update,$InstallRoot,[switch]$ProgressEvents)\nWrite-Output 'raw-install-detail'\nWrite-Output 'QCODE_PROGRESS|10|download'\nWrite-Output 'QCODE_PROGRESS|35|verify'\nWrite-Output 'QCODE_PROGRESS|90|activate'\nexit 0\n");
  const stages=[];assert.equal(await installUpdate(gateway,'1.0.0',root,installer,'opencode',message=>stages.push(message)),true);
  assert.ok(stages.some(value=>value.includes('下载')));assert.ok(stages.some(value=>value.includes('校验')));assert.ok(stages.some(value=>value.includes('切换')));
  assert.ok(stages.every(value=>!value.includes('raw-install-detail')));
  fs.writeFileSync(installer,"param($Gateway,[switch]$Update,$InstallRoot,[switch]$ProgressEvents)\nWrite-Error 'diagnostic failure'\nexit 1\n");
  await assert.rejects(installUpdate(gateway,'1.0.0',root,installer,'opencode',()=>{}),error=>error.message.includes('日志：')&&error.message.includes('当前版本仍可使用'));
  const logs=fs.readdirSync(path.join(root,'logs')).map(name=>fs.readFileSync(path.join(root,'logs',name),'utf8')).join('\n');
  assert.match(logs,/raw-install-detail/);assert.match(logs,/diagnostic failure/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'current.json'))).version,'1.0.0');
});
