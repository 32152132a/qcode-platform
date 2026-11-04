import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createVault } from '../src/database.js';
import { emptyState, normalizeState } from '../src/state.js';

// Offline only: retain identities, usage and purchased periods while simplifying terms.
export function simplifyPlans({filename,secret,backupPath,apply=false}) {
  if(!fs.existsSync(filename))throw new Error('数据库不存在');
  const vault=createVault(secret),sql=new DatabaseSync(filename,{readOnly:!apply});
  const tables=Object.entries(emptyState()).filter(([,value])=>Array.isArray(value)).map(([name])=>name);
  try {
    sql.exec('PRAGMA busy_timeout=100;');
    if(apply)sql.exec('BEGIN EXCLUSIVE');
    const version=sql.prepare('PRAGMA user_version').get().user_version;
    const metadata=JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data);
    if(version===6 && metadata.version===6){if(apply)sql.exec('ROLLBACK');return {alreadyApplied:true,version:6};}
    if(version!==5 || metadata.version!==5)throw new Error('仅支持 v5 数据库；v4 请先运行 remove-departments.js');
    const state={...metadata};
    for(const table of tables)state[table]=sql.prepare('SELECT data FROM "'+table+'" ORDER BY rowid').all().map(row=>JSON.parse(row.data));
    for(const key of state.keys)vault.decrypt(key.secret);
    if(state.requests.some(row=>row.status==='pending'))throw new Error('存在进行中的请求，请先正常停止网关');
    const summary={version:6,plans:state.plans.length,subscriptions:state.subscriptions.length,orders:state.planOrders.length,users:state.users.length,requests:state.requests.length,requiresStoppedGateway:true};
    if(!apply)return summary;
    if(!backupPath || path.resolve(filename)===path.resolve(backupPath))throw new Error('请指定独立的备份路径');
    fs.mkdirSync(path.dirname(backupPath),{recursive:true,mode:0o700});
    fs.writeFileSync(backupPath,JSON.stringify({format:'qcode-encrypted-backup-v1',ciphertext:vault.encrypt(JSON.stringify({format:'qcode-backup-v5',createdAt:new Date().toISOString(),state}))}),{flag:'wx',mode:0o600});
    function simplifyTerms(terms){
      const limit=terms.quotas?.totalTokens ?? 0;
      if(!Number.isSafeInteger(limit)||limit<0)throw new Error('套餐总 Token 格式不正确');
      terms.token_limit=limit===0?null:limit;
      delete terms.quotas;delete terms.max_concurrent_requests;
    }
    for(const plan of state.plans)simplifyTerms(plan);
    for(const item of [...state.subscriptions,...state.planOrders])simplifyTerms(item.terms);
    for(const user of state.users){delete user.model_id;delete user.max_concurrent_requests;}
    state.version=6;normalizeState(state,vault);
    for(const table of ['users','plans','subscriptions','planOrders']) {
      const update=sql.prepare('UPDATE "'+table+'" SET data=? WHERE id=?');
      for(const row of state[table])update.run(JSON.stringify(row),String(row.id));
    }
    metadata.version=6;
    sql.prepare('UPDATE metadata SET data=? WHERE id=1').run(JSON.stringify(metadata));
    sql.exec('PRAGMA user_version=6; COMMIT;');
    return {...summary,backupPath};
  }catch(error){if(apply){try{sql.exec('ROLLBACK')}catch{}}throw error;}finally{sql.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply'))throw new Error('用法：node scripts/simplify-plans.js [--apply]');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    console.log(JSON.stringify(simplifyPlans({filename:path.resolve(process.env.DB_PATH || './data/qcode.sqlite'),secret:process.env.KEY_ENCRYPTION_SECRET,backupPath:path.resolve(process.env.QCODE_MIGRATION_BACKUP || './backups/before-simplify-plans-'+stamp+'.qcode-backup'),apply:args.includes('--apply')})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
