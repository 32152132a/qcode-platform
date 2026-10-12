import fs from 'node:fs';
import path from 'node:path';
import {prepareTuiProfile} from './tui-profile.mjs';

// Keep the managed overlay separate from personal Harness configuration.
export function prepareHarnessLaunch({entry,mode='web',home,config,baseUrl,workdir,noOpen=false}) {
  if(!['web','tui'].includes(mode))throw new Error('Unsupported Harness mode');
  const patch=[{id:'llm-pi-ai',config:{providers:{qcode:{displayName:config.organizationName,apiKeyEnv:'QCODE_TOKEN',api:'openai-completions',baseURL:baseUrl,
    compat:{supportsDeveloperRole:false,maxTokensField:config.maxTokensField},models:[{id:'qcode-model',name:'团队模型',contextWindow:config.contextWindow,maxTokens:config.maxOutputTokens}]}}}},
    {id:'agent-default-model',config:{provider:'qcode',model:'qcode-model'}}];
  fs.mkdirSync(home,{recursive:true});
  const overlay=path.join(home,'qcode-managed.patch.yml');
  const profile=mode==='tui'?prepareTuiProfile(entry,home):'web';
  if(mode==='tui'&&!fs.existsSync(path.join(home,'profiles',profile,'package.json'))){
    throw new Error('此用户尚未安装兼容的 TUI 插件。请先使用 qcode web；原有独立 TUI 启动脚本不受影响。');
  }
  if(mode==='tui'){
    patch.push({id:'dsh-tui',config:{provider:'qcode',model:'qcode-model',cwd:path.resolve(workdir||process.cwd())}});
  }
  fs.writeFileSync(overlay,JSON.stringify(patch,null,2),{mode:0o600});
  const args=mode==='tui'?[path.resolve(entry),'--profile',profile,'--patch',overlay]:[path.resolve(entry),profile,'--patch',overlay];
  if(mode==='web'){args.push('--host','127.0.0.1','--port','0');if(noOpen)args.push('--no-open');}
  return args;
}
