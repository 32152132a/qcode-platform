import fs from 'node:fs';
import path from 'node:path';
import {fail} from './domain.js';
export function desktopInstaller(directory){
  const manifestFile=path.join(directory,'desktop','manifest.json');
  if(!fs.existsSync(manifestFile))return null;
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const name=`QCodeDesktopSetup-${manifest.version}.exe`;
  if(!/^\d+\.\d+\.\d+$/.test(manifest.version)||manifest.installer!==name||!fs.existsSync(path.join(directory,'desktop',name)))return null;
  return {name,filename:path.join(directory,'desktop',name)};
}
export function registerDesktopDistribution(app,directory){
  const root=path.join(directory,'desktop');
  app.get('/downloads/desktop/installer',(_req,res)=>{
    const installer=desktopInstaller(directory);
    if(!installer)fail(503,'DESKTOP_NOT_PUBLISHED','桌面安装包尚未发布');
    res.setHeader('Cache-Control','no-store');
    res.download(installer.filename,installer.name);
  });
  app.get('/downloads/desktop/:filename',(req,res)=>{
    const name=req.params.filename;
    if(!/^(manifest\.json|latest\.yml|QCodeDesktopSetup-\d+\.\d+\.\d+\.exe(?:\.blockmap)?)$/.test(name))fail(404,'NOT_FOUND','下载文件不存在');
    const file=path.join(root,name);
    if(!fs.existsSync(file))fail(404,'NOT_FOUND','下载文件不存在');
    res.setHeader('Cache-Control','no-store');
    if(name==='manifest.json')res.type('application/json').sendFile(file);
    else if(name==='latest.yml')res.type('text/yaml').sendFile(file);
    else res.download(file,name);
  });
}
