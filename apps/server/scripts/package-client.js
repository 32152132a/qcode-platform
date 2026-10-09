import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const source=fileURLToPath(new URL('../../client/',import.meta.url)), output=fileURLToPath(new URL('../releases/',import.meta.url));
const version='0.3.0';
const crcTable=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(buffer){let value=0xffffffff;for(const byte of buffer)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function filesIn(directory){return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.name==='node_modules'||entry.name.startsWith('.'))return [];
  const full=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in client distributions');
  if(entry.isDirectory())return filesIn(full);return /\.(ps1|cmd|mjs|json|md)$/.test(entry.name)?[full]:[];
});}
const local=[],central=[];let offset=0;
for(const filename of filesIn(source)){
  const name=Buffer.from(path.relative(source,filename).split(path.sep).join('/')),data=fs.readFileSync(filename),crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,data);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
  central.push(record,name);offset+=header.length+name.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const archive=Buffer.concat([...local,directory,end]);fs.mkdirSync(output,{recursive:true});
const name=`qcode-client-${version}.zip`;fs.writeFileSync(path.join(output,name),archive);
const manifest={version,downloadUrl:`/downloads/${name}`,sha256:createHash('sha256').update(archive).digest('hex'),size:archive.length,nodeVersion:'24.19.0',harnessVersion:'0.2.0-rc.2'};
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
