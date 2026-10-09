import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './domain.js';
export function registerDistribution(app) {
  const directory=fileURLToPath(new URL('../releases/',import.meta.url));
  app.get('/downloads/manifest.json',(_req,res)=>{
    const filename=path.join(directory,'manifest.json');
    if(!fs.existsSync(filename))fail(503,'CLIENT_NOT_PACKAGED','客户端安装包尚未生成，请运行 npm run package:client');
    res.sendFile(filename);
  });
  app.get('/downloads/:filename',(req,res)=>{
    if(!/^(qcode-client-\d+\.\d+\.\d+\.zip|QCodeSetup-\d+\.\d+\.\d+\.exe)$/.test(req.params.filename))fail(404,'NOT_FOUND','下载文件不存在');
    const filename=path.join(directory,req.params.filename);
    if(!fs.existsSync(filename))fail(404,'NOT_FOUND','安装包不存在');
    res.download(filename,req.params.filename);
  });
}
