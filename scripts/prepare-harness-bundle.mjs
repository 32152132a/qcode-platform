import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// Run with the Harness repository's tsx so its packaging helpers resolve their dependencies.
if(process.argv.length!==4)throw new Error('Expected repository and staging arguments');
const [repository,staging]=process.argv.slice(2).map(value=>path.resolve(value));
if(!repository||!staging||staging===repository||repository.startsWith(staging+path.sep))throw new Error('Expected separate repository and staging directories');
const helper=await import(pathToFileURL(path.join(repository,'scripts/executable-packaging.ts')));
const links=await import(pathToFileURL(path.join(repository,'scripts/build-exe-for-python-sdk-staging.ts')));
await helper.restoreLegacyHoists(staging,path.join(repository,'apps/cli/node_modules'));
await links.materializeStagedLinks(staging);
// Legacy deploy omits some vendored link/peer packages; ship their built files explicitly.
for(const directory of await fs.readdir(path.join(repository,'vendor'),{withFileTypes:true})){
  if(!directory.isDirectory())continue;
  const source=path.join(repository,'vendor',directory.name);
  let vendor;
  try{vendor=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const destination=path.join(staging,'node_modules',vendor.name);
  await fs.mkdir(destination,{recursive:true});
  await fs.copyFile(path.join(source,'package.json'),path.join(destination,'package.json'));
  await fs.cp(path.join(source,'lib'),path.join(destination,'lib'),{recursive:true});
  for(const file of ['LICENSE','LICENSE.md'])try{await fs.copyFile(path.join(source,file),path.join(destination,file));}catch(error){if(error.code!=='ENOENT')throw error;}
}
// The CLI's production manifest does not enumerate all transitive workspace peers.
// Complete only the reachable workspace packages, using their published file lists.
const workspaces=new Map();
for await(const file of fs.glob('packages/*/*/package.json',{cwd:repository})){
  const directory=path.dirname(path.join(repository,file));
  const info=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  workspaces.set(info.name,{directory,info});
}
const queue=[JSON.parse(await fs.readFile(path.join(staging,'package.json'),'utf8'))];
const seen=new Set();
while(queue.length){
  const info=queue.shift();if(seen.has(info.name))continue;seen.add(info.name);
  for(const name of Object.keys({...info.dependencies,...info.peerDependencies})){
    const destination=path.join(staging,'node_modules',name);
    let installed;
    try{installed=JSON.parse(await fs.readFile(path.join(destination,'package.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!installed&&workspaces.has(name)){
      const {directory,info:sourceInfo}=workspaces.get(name);
      await fs.mkdir(destination,{recursive:true});
      for await(const file of fs.glob([...(sourceInfo.files||['lib/**']),'package.json','LICENSE*','NOTICE*'],{cwd:directory})){
        const target=path.join(destination,file);await fs.mkdir(path.dirname(target),{recursive:true});
        await fs.cp(path.join(directory,file),target,{recursive:true});
      }
      installed=sourceInfo;
    }
    if(installed)queue.push(installed);
  }
}
const manifest=JSON.parse(await fs.readFile(path.join(staging,'package.json'),'utf8'));
const frontend=path.join(staging,'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html');
const html=await fs.readFile(frontend,'utf8');
if(!html.includes('<title>QCode</title>')||!html.includes('qcode.svg'))throw new Error('Build with pnpm run build:qcode before packaging');
execFileSync(process.execPath,[path.join(staging,'lib/bin.js'),'--help'],{stdio:'pipe',timeout:30000});
await fs.copyFile(path.join(repository,'LICENSE'),path.join(staging,'LICENSE'));
await fs.copyFile(path.join(repository,'THIRD_PARTY_NOTICES.md'),path.join(staging,'THIRD_PARTY_NOTICES.md'));
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
await fs.writeFile(path.join(staging,'qcode-runtime.json'),JSON.stringify({brand:'QCode',version:manifest.version,commit,platform:process.platform,arch:process.arch,entry:'lib/bin.js'},null,2));
console.log(`Validated QCode runtime ${manifest.version} (${commit})`);
