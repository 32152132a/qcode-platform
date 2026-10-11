import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function nextVersion(local,published){
  function parse(value){
    if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))throw new Error('Invalid release version');
    const parts=value.split('.').map(Number);
    if(!parts.every(Number.isSafeInteger))throw new Error('Release version is too large');
    return parts;
  }
  let latest=parse(local);
  if(published){
    const remote=parse(published);
    for(let i=0;i<3;i++){
      if(remote[i]===latest[i])continue;
      if(remote[i]>latest[i])latest=remote;
      break;
    }
  }
  if(latest[2]===Number.MAX_SAFE_INTEGER)throw new Error('Patch version is too large');
  latest[2]++;
  return latest.join('.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const filename=process.argv[2];
  const metadata=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  const previous=metadata.version;
  metadata.version=nextVersion(previous,process.argv[3]);
  const temporary=filename+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(metadata,null,2)+'\n');fs.renameSync(temporary,filename);}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  console.log(`Client version: ${previous} -> ${metadata.version}`);
}
