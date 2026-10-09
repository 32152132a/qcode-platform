import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export function newerVersion(left,right){const a=left.split('.').map(Number),b=right.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
export async function installUpdate(gateway,currentVersion,installRoot,installer) {
  const url=new URL(gateway);
  if(url.protocol!=='https:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('自动更新要求 HTTPS 网关');
  if(!fs.existsSync(path.join(installRoot,'current.json')))return false;
  const response=await fetch(url.origin+'/downloads/manifest.json',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('暂时无法获取客户端更新');
  const manifest=await response.json();
  if(!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('无效的客户端更新版本');
  if(!newerVersion(manifest.version,currentVersion))return false;
  await new Promise((resolve,reject)=>{
    const process=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,'-Gateway',gateway,'-Update','-InstallRoot',installRoot],{stdio:'inherit',windowsHide:true});
    process.once('error',reject);process.once('exit',code=>code===0?resolve():reject(new Error('客户端自动更新失败，保留当前版本')));
  });
  return true;
}
