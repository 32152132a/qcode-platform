import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './domain.js';
export function registerDistribution(app,{directory=fileURLToPath(new URL('../releases/',import.meta.url))}={}) {
  app.get('/downloads/installer',(_req,res)=>{
    const filename=path.join(directory,'manifest.json');
    if(!fs.existsSync(filename))fail(503,'INSTALLER_NOT_PUBLISHED','Windows 安装包尚未发布，请联系管理员');
    const manifest=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(!/^\/downloads\/QCodeSetup-\d+\.\d+\.\d+\.exe$/.test(manifest.installerUrl||''))fail(503,'INSTALLER_NOT_PUBLISHED','Windows 安装包尚未发布，请联系管理员');
    const name=path.basename(manifest.installerUrl);
    if(!fs.existsSync(path.join(directory,name)))fail(503,'INSTALLER_NOT_PUBLISHED','Windows 安装包尚未发布，请联系管理员');
    res.setHeader('Cache-Control','no-store');
    res.download(path.join(directory,name),name);
  });
  app.get('/downloads/manifest.json',(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const filename=path.join(directory,'manifest.json');
    if(!fs.existsSync(filename))fail(503,'CLIENT_NOT_PACKAGED','客户端安装包尚未发布，请联系管理员');
    res.sendFile(filename);
  });
  app.get('/downloads/:filename',(req,res)=>{
    if(!/^(qcode-client-\d+\.\d+\.\d+\.zip|QCodeSetup-\d+\.\d+\.\d+\.exe)$/.test(req.params.filename))fail(404,'NOT_FOUND','下载文件不存在');
    const filename=path.join(directory,req.params.filename);
    if(!fs.existsSync(filename))fail(404,'NOT_FOUND','安装包不存在');
    res.download(filename,req.params.filename);
  });
}
