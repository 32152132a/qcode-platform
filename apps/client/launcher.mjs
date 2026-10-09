import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GatewaySession, startBridge } from './bridge.mjs';
import { secureStore, lockSession } from './session-store.mjs';
import { syncSkills } from './skills.mjs';
import { installUpdate } from './update.mjs';
import { fileURLToPath } from 'node:url';
export const version='0.3.0';
export function compareVersions(a,b){const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++){if(left[i]!==right[i])return left[i]-right[i];}return 0;}
const args=Object.fromEntries(process.argv.slice(2).reduce((all,value,index,array)=>{if(value.startsWith('--'))all.push([value.slice(2),array[index+1]]);return all;},[]));
let releaseLock,bridge,child,timer,stopping=false;
async function close(code=0){
  if(stopping)return;stopping=true;clearInterval(timer);
  if(child && child.exitCode===null)child.kill();
  await bridge?.close(); releaseLock?.();releaseLock=null;process.exitCode=code;
}
try{
  if(!args.session||!args.gateway||!args.entry)throw new Error('Missing launcher arguments');
  releaseLock=lockSession(path.join(path.dirname(args.session),'running.lock'));
  const store=secureStore(args.session), session=new GatewaySession(args.gateway,store.read(),value=>store.write(value));
  await session.renew();
  const startupConfig=await session.json('/client/config');
  if(startupConfig.autoUpdate && !process.env.QCODE_SKIP_UPDATE){
    const installRoot=path.dirname(path.dirname(args.session));
    let updated=false;
    try{updated=await installUpdate(args.gateway,version,installRoot,fileURLToPath(new URL('./install.ps1',import.meta.url)));}
    catch(error){console.warn(`QCode 更新检查失败：${error.message}。继续检查当前版本是否允许使用。`);}
    if(updated){
      releaseLock();releaseLock=null;
      const restart=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(installRoot,'bin','bootstrap.ps1'),args.mode||'web','-Gateway',args.gateway,...(args.workdir?['-WorkDir',args.workdir]:[]),...(args['no-open']==='true'?['-NoOpen']:[])],{stdio:'inherit',windowsHide:true,env:{...process.env,QCODE_SKIP_UPDATE:'1'}});
      await new Promise((resolve,reject)=>{restart.once('error',reject);restart.once('exit',code=>{process.exitCode=code||0;resolve();});});
      process.exit(process.exitCode||0);
    }
  }
  const userId=session.session.user.id;
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error('Invalid account identity');
  const userRoot=path.join(path.dirname(args.session),'users',String(userId)), home=path.join(userRoot,'harness');
  const workdir=path.resolve(args.workdir||path.join(userRoot,'workspace'));
  fs.mkdirSync(workdir,{recursive:true});fs.mkdirSync(home,{recursive:true});
  let skillsRevision;
  async function updateSkills(config){
    if(compareVersions(config.minimumClientVersion,version)>0)throw Object.assign(new Error('客户端版本过旧，请运行 qcode update'),{code:'CLIENT_VERSION_REQUIRED'});
    if(config.skillsRevision===skillsRevision)return;
    const {skills}=await session.json('/client/skills');await syncSkills(home,skills);skillsRevision=config.skillsRevision;
  }
  bridge=await startBridge(session,{onConfig:updateSkills});await updateSkills(bridge.configuration);
  const config=bridge.configuration;
  const patch=[{id:'llm-pi-ai',config:{providers:{qcode:{displayName:config.organizationName,apiKeyEnv:'QCODE_TOKEN',api:'openai-completions',baseURL:bridge.baseUrl,
    compat:{supportsDeveloperRole:false,maxTokensField:config.maxTokensField},models:[{id:'qcode-model',name:'团队模型',contextWindow:config.contextWindow,maxTokens:config.maxOutputTokens}]}}}},
    {id:'agent-default-model',config:{provider:'qcode',model:'qcode-model'}}];
  fs.writeFileSync(path.join(home,'cordis.patch.yml'),JSON.stringify(patch,null,2),{mode:0o600});
  const command=args.mode==='tui'?'tui':'web', launchArgs=[path.resolve(args.entry),command];
  if(command==='web'){launchArgs.push('--host','127.0.0.1','--port','0');if(args['no-open']==='true')launchArgs.push('--no-open');}
  const env={...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(userRoot,'agents'),QCODE_TOKEN:bridge.token};delete env.DEEPSEEK_API_KEY;delete env.OPENAI_API_KEY;
  console.log(`QCode ${version} · ${session.session.user.username} · ${workdir}`);
  child=spawn(process.execPath,launchArgs,{cwd:workdir,env,stdio:'inherit',windowsHide:true});
  child.once('error',async()=>{console.error('Harness 启动失败，请运行 qcode doctor');await close(1);});
  child.once('exit',code=>void close(code||0));
  let heartbeat=false;
  timer=setInterval(async()=>{if(heartbeat||stopping)return;heartbeat=true;try{await session.renew();await bridge.refreshConfig(true);}catch(error){console.error(`QCode: ${error.message}`);if(['INVALID_TOKEN','USER_DISABLED','CLIENT_VERSION_REQUIRED'].includes(error.code))await close(1);}finally{heartbeat=false;}},45000);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close());
}catch(error){console.error(`QCode: ${error.message}`);await close(1);}
