import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const folders=['src','public','scripts','test','../client'];let count=0;
function check(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.name==='node_modules'||entry.name==='harness')continue;const file=path.join(directory,entry.name);if(entry.isDirectory())check(file);else if(/\.(js|mjs)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});if(result.error||result.status!==0){console.error(file,result.error?.message||result.stderr);process.exitCode=1;}count++;}}}
for(const folder of folders)check(folder);if(!process.exitCode)console.log(`Syntax checks passed for ${count} JavaScript modules.`);
