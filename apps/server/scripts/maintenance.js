import path from 'node:path';
import { backupDatabase, restoreDatabase, migrateDatabase, archiveAudits } from '../src/maintenance.js';
const [command,...rest]=process.argv.slice(2),options={};
for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw new Error('Options require --name value');options[rest[i].slice(2)]=rest[i+1];}
const secret=process.env.KEY_ENCRYPTION_SECRET,filename=path.resolve(process.env.DB_PATH||'./data/qcode.sqlite');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
try{
  let result;
  if(command==='backup')result=backupDatabase(filename,path.resolve(options.output||`backups/${stamp}.qcode-backup`),secret);
  else if(command==='restore'){if(!options.input||!options.target)throw new Error('restore requires --input BACKUP --target NEW_DATABASE');result=restoreDatabase(path.resolve(options.input),path.resolve(options.target),secret);}
  else if(command==='migrate'){if(!options.target)throw new Error('migrate requires --target NEW_DATABASE.sqlite');result=migrateDatabase(filename,path.resolve(options.target),secret);}
  else if(command==='archive-audits')result=archiveAudits(filename,path.resolve(options.output||`backups/audits-${stamp}.json`),secret,options.days===undefined?undefined:Number(options.days));
  else throw new Error('Commands: backup, restore --input FILE --target FILE, migrate --target FILE, archive-audits --days N');
  console.log(JSON.stringify({ok:true,...result}));
}catch(error){console.error(error.message);process.exitCode=1;}
