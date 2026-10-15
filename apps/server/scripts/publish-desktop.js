import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function publishDesktop(source,releases){
  source=path.resolve(source);const destination=path.resolve(releases,'desktop');
  if(source===destination)throw new Error('Source must differ from releases');
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
  if(manifest.product!=='QCodeDesktop'||!/^\d+\.\d+\.\d+$/.test(manifest.version)||manifest.installer!==`QCodeDesktopSetup-${manifest.version}.exe`)throw new Error('Invalid desktop manifest');
  const required=[manifest.installer,manifest.installer+'.blockmap','latest.yml'];
  if(!Array.isArray(manifest.files)||manifest.files.length!==required.length)throw new Error('Invalid release files');
  for(const name of required){
    const file=manifest.files.find(file=>file.name===name);
    if(!file||!/^[a-f0-9]{64}$/.test(file.sha256)||hash(path.join(source,name))!==file.sha256)throw new Error('Release checksum mismatch: '+name);
  }
  fs.mkdirSync(destination,{recursive:true});
  const lock=path.join(destination,'.publish.lock');
  const descriptor=fs.openSync(lock,'wx');
  const stage=fs.mkdtempSync(path.join(destination,'.stage-'));
  try{
    for(const file of manifest.files){
      const target=path.join(destination,file.name);
      if(file.name!=='latest.yml'&&fs.existsSync(target)&&hash(target)!==file.sha256)throw new Error('Version already exists; increment version');
      fs.copyFileSync(path.join(source,file.name),path.join(stage,file.name));
      if(hash(path.join(stage,file.name))!==file.sha256)throw new Error('Copied file checksum mismatch');
    }
    for(const file of manifest.files)if(file.name!=='latest.yml')fs.renameSync(path.join(stage,file.name),path.join(destination,file.name));
    // All immutable artifacts are in place before either public pointer changes.
    fs.renameSync(path.join(stage,'latest.yml'),path.join(destination,'latest.yml'));
    const pointer=path.join(destination,'.manifest-'+randomUUID()+'.json');
    fs.writeFileSync(pointer,JSON.stringify(manifest,null,2));
    fs.renameSync(pointer,path.join(destination,'manifest.json'));
    const keep=new Set(manifest.files.map(file=>file.name));
    for(const entry of fs.readdirSync(destination,{withFileTypes:true})){
      if(entry.isFile()&&!keep.has(entry.name)&&/^QCodeDesktopSetup-\d+\.\d+\.\d+\.exe(?:\.blockmap)?$/.test(entry.name))fs.unlinkSync(path.join(destination,entry.name));
    }
    return manifest;
  }finally{fs.rmSync(stage,{recursive:true,force:true});fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=publishDesktop(process.argv[2],process.argv[3]);
  console.log('Published QCode Desktop '+manifest.version);
}
