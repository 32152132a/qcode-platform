// Explicit offline v4 -> v5 migration. The running gateway never upgrades old data.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createVault} from '../src/database.js';
import {emptyState} from '../src/state.js';

export function removeDepartments({filename,secret,backupPath,apply=false}) {
  if (!fs.existsSync(filename)) throw new Error('数据库不存在');
  const vault=createVault(secret),sql=new DatabaseSync(filename,{readOnly:!apply});
  const tables=Object.entries(emptyState()).filter(([,value])=>Array.isArray(value)).map(([name])=>name);
  try {
    sql.exec('PRAGMA busy_timeout=100;');
    if(apply)sql.exec('BEGIN EXCLUSIVE');
    const version=sql.prepare('PRAGMA user_version').get().user_version;
    const metadata=JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data);
    const names=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name);
    if(version===5 && metadata.version===5 && !names.includes('departments')) {
      if(apply)sql.exec('ROLLBACK');
      return {alreadyApplied:true,version:5};
    }
    if(version!==4 || metadata.version!==4 || ![...tables,'departments'].every(name=>names.includes(name)))throw new Error('仅支持完整的 v4 数据库，请先核对数据库版本');
    const state={...metadata};
    for(const table of [...tables,'departments'])state[table]=sql.prepare('SELECT data FROM "'+table+'" ORDER BY rowid').all().map(row=>JSON.parse(row.data));
    for(const key of state.keys)vault.decrypt(key.secret);
    if(state.requests.some(row=>row.status==='pending'))throw new Error('存在进行中的请求，请先正常停止网关后再迁移');
    const summary={version:5,removedDepartments:state.departments.length,users:state.users.length,models:state.models.length,keys:state.keys.length,skills:state.skills.length,requests:state.requests.length,plans:state.plans.length,subscriptions:state.subscriptions.length,requiresStoppedGateway:true};
    if(!apply)return summary;
    if(!backupPath || path.resolve(filename)===path.resolve(backupPath))throw new Error('请指定独立的备份路径');
    fs.mkdirSync(path.dirname(backupPath),{recursive:true,mode:0o700});
    fs.writeFileSync(backupPath,JSON.stringify({format:'qcode-encrypted-backup-v1',ciphertext:vault.encrypt(JSON.stringify({format:'qcode-backup-v4',createdAt:new Date().toISOString(),state}))}),{flag:'wx',mode:0o600});
    for(const user of state.users) {
      const group=state.departments.find(item=>item.id===user.department_id);
      if(user.quota_mode==='department' && group?.user_quotas)user.quotas=structuredClone(group.user_quotas);
      if(!user.model_id && group?.model_id)user.model_id=group.model_id;
      if(!user.key_id && group?.key_id)user.key_id=group.key_id;
      delete user.department;delete user.department_id;delete user.quota_mode;
    }
    for(const row of state.requests){delete row.department_id;delete row.department_name;}
    for(const skill of state.skills)delete skill.department_ids;
    delete state.departments;state.version=5;
    for(const table of tables) {
      const update=sql.prepare('UPDATE "'+table+'" SET data=? WHERE id=?');
      for(const row of state[table])update.run(JSON.stringify(row),String(table==='tokens'?row.token_hash:row.id));
    }
    const nextMetadata=Object.fromEntries(Object.entries(state).filter(([name])=>!tables.includes(name)));
    sql.prepare('UPDATE metadata SET data=? WHERE id=1').run(JSON.stringify(nextMetadata));
    sql.exec('DROP INDEX IF EXISTS request_department; DROP TABLE departments; PRAGMA user_version=5; COMMIT;');
    return {...summary,backupPath};
  } catch(error) {
    if(apply){try{sql.exec('ROLLBACK')}catch{}}
    throw error;
  } finally {sql.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply'))throw new Error('用法：node scripts/remove-departments.js [--apply]');
    const filename=path.resolve(process.env.DB_PATH || './data/qcode.sqlite'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
    console.log(JSON.stringify(removeDepartments({filename,secret:process.env.KEY_ENCRYPTION_SECRET,backupPath:path.resolve(process.env.QCODE_MIGRATION_BACKUP || './backups/before-remove-departments-'+stamp+'.qcode-backup'),apply:args.includes('--apply')})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
