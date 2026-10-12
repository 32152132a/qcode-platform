import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const outputIndex=process.argv.indexOf('--output');
const source=fileURLToPath(new URL('../../client/',import.meta.url)), output=outputIndex>=0?path.resolve(process.argv[outputIndex+1]):fileURLToPath(new URL('../releases/',import.meta.url));
const {version}=JSON.parse(fs.readFileSync(path.join(source,'release.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid client release version');
const openCodeIndex=process.argv.indexOf('--opencode-bundle');
const isOpenCode=openCodeIndex>=0;
const bundleIndex=isOpenCode?openCodeIndex:process.argv.indexOf('--harness-bundle');
const bundle=bundleIndex>=0?path.resolve(process.argv[bundleIndex+1]||''):null;
if(!bundle)throw new Error('Provide --opencode-bundle or --harness-bundle');
const runtime=JSON.parse(fs.readFileSync(bundle+'.json','utf8').replace(/^\uFEFF/,''));
const expectedEntry=isOpenCode?'bin/qcode-engine.exe':'lib/bin.js';
if(runtime.brand!=='QCode'||runtime.platform!=='win32'||!['x64','arm64'].includes(runtime.arch)||runtime.entry!==expectedEntry||!/^[a-f0-9]{40}$/.test(runtime.commit)||createHash('sha256').update(fs.readFileSync(bundle)).digest('hex')!==runtime.sha256)throw new Error('Invalid custom runtime artifact');
if(isOpenCode&&(runtime.runtime!=='opencode'||!/^[a-f0-9]{64}$/.test(runtime.binarySha256)))throw new Error('Invalid OpenCode artifact');
let tui, tuiBundle;
if(!isOpenCode){
  const tuiIndex=process.argv.indexOf('--tui-bundle');
  if(tuiIndex<0||!process.argv[tuiIndex+1])throw new Error('Provide --tui-bundle to include the compatible TUI runtime');
  tuiBundle=path.resolve(process.argv[tuiIndex+1]);
  tui=JSON.parse(fs.readFileSync(tuiBundle+'.json','utf8').replace(/^\uFEFF/,''));
  if(tui.platform!==runtime.platform||tui.arch!==runtime.arch||tui.entry!=='node_modules/@deepseek-ai/dsh/lib/bin.js'||!/^[a-f0-9]{64}$/.test(tui.lockSha256)||createHash('sha256').update(fs.readFileSync(tuiBundle)).digest('hex')!==tui.sha256)throw new Error('Invalid TUI artifact');
}
const nodeIndex=process.argv.indexOf('--node-archive');
if(nodeIndex<0||!process.argv[nodeIndex+1])throw new Error('Provide --node-archive to build a complete installer');
const nodeArchive=path.resolve(process.argv[nodeIndex+1]);
const nodeHash=runtime.arch==='arm64'?'8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f':'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
if(createHash('sha256').update(fs.readFileSync(nodeArchive)).digest('hex')!==nodeHash)throw new Error('Bundled Node checksum or architecture mismatch');
const crcTable=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(buffer){let value=0xffffffff;for(const byte of buffer)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function filesIn(directory){return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.name==='node_modules'||entry.name.startsWith('.'))return [];
  const full=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in client distributions');
  if(entry.isDirectory())return filesIn(full);return /\.(ps1|cmd|mjs|json|md)$/.test(entry.name)?[full]:[];
});}
const local=[],central=[];let offset=0;
const entries=filesIn(source).filter(filename=>!isOpenCode||!path.relative(source,filename).startsWith('harness'+path.sep)).map(filename=>({name:path.relative(source,filename).split(path.sep).join('/'),filename}));
const runtimeName=isOpenCode?'opencode-bundle':'harness-bundle';
entries.push({name:runtimeName+'.zip',filename:bundle},{name:runtimeName+'.json',filename:bundle+'.json'});
if(isOpenCode){const release=entries.find(entry=>entry.name==='release.json');release.data=Buffer.from(JSON.stringify({version,runtime:'opencode'}));}
if(tuiBundle)entries.push({name:'tui-bundle.zip',filename:tuiBundle},{name:'tui-bundle.json',filename:tuiBundle+'.json'});
entries.push({name:`node-v24.19.0-win-${runtime.arch}.zip`,filename:nodeArchive});
entries.push({name:'node-bundle.json',data:Buffer.from(JSON.stringify({version:'24.19.0',arch:runtime.arch,sha256:nodeHash}))});
for(const entry of entries){
  const name=Buffer.from(entry.name),data=entry.data||fs.readFileSync(entry.filename),crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,data);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
  central.push(record,name);offset+=header.length+name.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const archive=Buffer.concat([...local,directory,end]);fs.mkdirSync(output,{recursive:true});
const name=`qcode-client-${version}.zip`;fs.writeFileSync(path.join(output,name),archive);
const manifest={version,downloadUrl:`/downloads/${name}`,sha256:createHash('sha256').update(archive).digest('hex'),size:archive.length,nodeVersion:'24.19.0',runtime:isOpenCode?'opencode':'harness',tuiVersion:tui?.tuiVersion,tuiHarnessVersion:tui?.harnessVersion};
if(runtime)Object.assign(manifest,{harnessVersion:runtime.version,harnessCommit:runtime.commit,harnessBrand:'QCode',platform:runtime.platform,arch:runtime.arch});
if(isOpenCode)Object.assign(manifest,{opencodeVersion:runtime.version,opencodeCommit:runtime.commit});
const manifestPath=path.join(output,'manifest.json');
if(fs.existsSync(manifestPath)){
  const previous=JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''));
  const installer=path.join(output,`QCodeSetup-${version}.exe`);
  if(previous.sha256===manifest.sha256 && fs.existsSync(installer) && previous.installerSha256===createHash('sha256').update(fs.readFileSync(installer)).digest('hex')){
    manifest.installerUrl=`/downloads/QCodeSetup-${version}.exe`;manifest.installerSha256=previous.installerSha256;
  }
}
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
console.log(`Built ${name}: ${archive.length} bytes`);
