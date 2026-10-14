import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
const stages={check:'正在检查更新',download:'正在下载更新包',verify:'正在校验更新包',runtime:'正在安装编程运行环境',node:'正在准备内置 Node 运行环境',activate:'正在切换新版本',complete:'更新完成，正在重新启动'};
export function newerVersion(left,right){const a=left.split('.').map(Number),b=right.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
export async function installUpdate(gateway,currentVersion,installRoot,installer,expectedRuntime,onProgress=message=>console.log(`QCode 更新：${message}`)) {
  const url=new URL(gateway);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('无效的更新网关地址');
  if(!fs.existsSync(path.join(installRoot,'current.json')))return false;
  const logs=path.join(installRoot,'logs');
  const log=path.join(logs,`update-${randomUUID()}.log`);
  try{
  fs.mkdirSync(logs,{recursive:true});fs.writeFileSync(log,`QCode update from ${currentVersion}\n`);
  onProgress(stages.check);
  const response=await fetch(url.origin+'/downloads/manifest.json',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('暂时无法获取客户端更新');
  const manifest=await response.json();
  if(!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('无效的客户端更新版本');
  if(expectedRuntime==='opencode'&&manifest.runtime!=='opencode')throw new Error('更新包运行环境不兼容（incompatible runtime）');
  if(!newerVersion(manifest.version,currentVersion))return false;
  await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',installer,'-Gateway',gateway,'-Update','-InstallRoot',installRoot,'-ProgressEvents'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const decoder=new StringDecoder('utf8');let buffer='';
    function record(bytes){try{fs.appendFileSync(log,bytes);return true;}catch{child.kill();reject(new Error('无法写入更新日志，请检查磁盘空间和目录权限'));return false;}}
    function line(value){const match=/^QCODE_PROGRESS\|(\d{1,3})\|([a-z]+)$/.exec(value.trim());if(match&&stages[match[2]])onProgress(`${stages[match[2]]}（${match[1]}%）`);}
    child.stdout.on('data',bytes=>{
      if(!record(bytes))return;buffer+=decoder.write(bytes);let end;
      while((end=buffer.indexOf('\n'))!==-1){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}
      if(buffer.length>65536)buffer=buffer.slice(-4096);
    });
    child.stderr.on('data',record);
    child.once('error',reject);child.once('close',code=>{line(buffer+decoder.end());code===0?resolve():reject(new Error('客户端更新未完成，请检查网络、磁盘空间或文件占用；当前版本仍可使用'));});
  });
  return true;
  }catch(error){
    try{fs.appendFileSync(log,`\n${error.message}\n`);}catch{ /* A full disk must still produce a useful failure message. */ }
    const reason=error.code==='ENOSPC'?'磁盘空间不足':error.code==='EACCES'||error.code==='EPERM'?'无法写入安装目录或日志，请检查权限':error.name==='TimeoutError'||error.message==='fetch failed'?'更新下载连接失败，请检查网络后重试':error.message;
    throw new Error(`${reason}。日志：${log}`);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [gateway,root,installer,version,runtime]=process.argv.slice(2);
  installUpdate(gateway,version,root,installer,runtime).then(updated=>console.log(updated?'QCode 更新完成，请重新打开客户端。':'QCode 已是最新版本。')).catch(error=>{console.error(`QCode 更新失败：${error.message}`);process.exitCode=1;});
}
