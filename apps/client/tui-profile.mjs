import fs from 'node:fs';
import path from 'node:path';

// Profiles own user preferences; only immutable, versioned runtime files are shared.
export function prepareTuiProfile(entry,home){
  const runtime=path.resolve(path.dirname(entry),'../../../..');
  const metadataFile=path.join(runtime,'qcode-tui-runtime.json');
  if(!fs.existsSync(metadataFile))return 'qcode-tui'; // Explicit development entry.
  const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
  if(!/^[a-f0-9]{64}$/.test(metadata.lockSha256)||metadata.entry!=='node_modules/@deepseek-ai/dsh/lib/bin.js')throw new Error('Invalid bundled TUI metadata');
  for(const [name,version] of [['@deepseek-ai/dsh',metadata.harnessVersion],['@deepseek-harness-tui/dsh-tui',metadata.tuiVersion]]){
    const installed=JSON.parse(fs.readFileSync(path.join(runtime,'node_modules',name,'package.json'),'utf8'));
    if(installed.version!==version)throw new Error('Bundled TUI version mismatch; reinstall QCode');
  }
  const profile='qcode-tui-'+metadata.lockSha256.slice(0,12);
  const directory=path.join(home,'profiles',profile);
  fs.mkdirSync(directory,{recursive:true});
  const modules=path.join(directory,'node_modules'),target=path.join(runtime,'node_modules');
  if(fs.existsSync(modules)){
    if(fs.realpathSync(modules)!==fs.realpathSync(target)){
      if(!fs.lstatSync(modules).isSymbolicLink())throw new Error('TUI dependency directory is not a managed link');
      fs.unlinkSync(modules);fs.symlinkSync(target,modules,process.platform==='win32'?'junction':'dir');
    }
  }else{
    // A removed old release may leave a dangling link after an upgrade.
    try{if(fs.lstatSync(modules).isSymbolicLink())fs.unlinkSync(modules);}catch(error){if(error.code!=='ENOENT')throw error;}
    fs.symlinkSync(target,modules,process.platform==='win32'?'junction':'dir');
  }
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:profile,private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-harness-tui/dsh-tui']}}},null,2));
  return profile;
}
