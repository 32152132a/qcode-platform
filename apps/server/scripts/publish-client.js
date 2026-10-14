import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function checksum(filename){return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');}
export function publishClient(source,destination){
  source=path.resolve(source);destination=path.resolve(destination);
  if(source===destination)throw new Error('Source and release directory must differ');
  fs.mkdirSync(destination,{recursive:true});
  const lock=path.join(destination,'.publish.lock');
  let descriptor;
  try{descriptor=fs.openSync(lock,'wx');}
  catch(error){if(error.code==='EEXIST')throw new Error('Another publication is active; inspect .publish.lock before retrying');throw error;}
  try{return publishLocked(source,destination);}
  finally{fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
function publishLocked(source,destination){
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
  if(manifest.installerTestAppId)throw new Error('Test installers cannot be published');
  if(!/^\d+\.\d+\.\d+$/.test(manifest.version)||manifest.harnessBrand!=='QCode'||(manifest.platform&&manifest.platform!=='win32'))throw new Error('Expected a versioned QCode custom release');
  const files=[{name:`qcode-client-${manifest.version}.zip`,hash:manifest.sha256,url:manifest.downloadUrl},{name:`QCodeSetup-${manifest.version}.exe`,hash:manifest.installerSha256,url:manifest.installerUrl}];
  for(const file of files){
    if(file.url!==`/downloads/${file.name}`||!/^[a-f0-9]{64}$/.test(file.hash)||checksum(path.join(source,file.name))!==file.hash)throw new Error(`Release checksum or URL mismatch: ${file.name}`);
    const existing=path.join(destination,file.name);
    if(fs.existsSync(existing)&&checksum(existing)!==file.hash)throw new Error('This version is already published with different bytes; use a new version');
  }
  // Mac releases will have a separate namespace and manifest.
  fs.mkdirSync(path.join(destination,'macos'),{recursive:true});
  const stage=fs.mkdtempSync(path.join(destination,'.publish-'));
  try{
    for(const file of files){
      const staged=path.join(stage,file.name);fs.copyFileSync(path.join(source,file.name),staged);
      if(checksum(staged)!==file.hash)throw new Error('Copied artifact checksum mismatch');
      if(!fs.existsSync(path.join(destination,file.name)))fs.renameSync(staged,path.join(destination,file.name));
    }
    const pointer=path.join(destination,`.manifest-${randomUUID()}.json`);
    try{fs.writeFileSync(pointer,JSON.stringify(manifest,null,2));fs.renameSync(pointer,path.join(destination,'manifest.json'));}
    finally{if(fs.existsSync(pointer))fs.unlinkSync(pointer);}
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
  // Prune only Windows artifacts, after the new manifest is committed.
  const keep=new Set(files.map(file=>file.name));
  for(const entry of fs.readdirSync(destination,{withFileTypes:true})){
    if(!entry.isFile()||keep.has(entry.name)||!/^(qcode-client-\d+\.\d+\.\d+\.zip|QCodeSetup-\d+\.\d+\.\d+\.exe)$/.test(entry.name))continue;
    try{fs.unlinkSync(path.join(destination,entry.name));}
    catch(error){console.warn(`Release is active; could not remove old Windows artifact ${entry.name}: ${error.message}`);}
  }
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw new Error('Usage: node scripts/publish-client.js <artifact-directory> <release-directory>');
  const manifest=publishClient(process.argv[2],process.argv[3]);
  console.log(`Published QCode ${manifest.version}; employees download /downloads/installer`);
}
