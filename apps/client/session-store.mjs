import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const helper = fileURLToPath(new URL('./secure-store.ps1', import.meta.url));
export function secureStore(filename) {
  function invoke(action, input) {
    if (process.platform !== 'win32') throw new Error('QCode secure login storage currently requires Windows');
    const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Action',action,'-Path',filename], { input, encoding:'utf8', windowsHide:true, maxBuffer:1024*1024 });
    if (result.error || result.status !== 0) throw new Error('无法读写 Windows 加密登录信息，请重新登录或检查当前 Windows 账号');
    return result.stdout.replace(/^\uFEFF/,'');
  }
  return { read: () => JSON.parse(invoke('read')), write: value => invoke('write',JSON.stringify(value)) };
}
export function gatewayAddress(value) {
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('网关地址必须为不含路径和凭据的 HTTP(S) 地址');
  return url.origin;
}
export function lockSession(filename) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  try {
    const descriptor = fs.openSync(filename,'wx',0o600); fs.writeFileSync(descriptor,String(process.pid));
    return () => { fs.closeSync(descriptor); fs.unlinkSync(filename); };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(filename,'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('客户端运行锁损坏，请检查后清理');
    try { process.kill(pid,0); } catch (error) {
      if (error.code === 'ESRCH') { fs.unlinkSync(filename); return lockSession(filename); }
    }
    throw new Error('此网关已运行一个 qcode 客户端，请先关闭原窗口');
  }
}
