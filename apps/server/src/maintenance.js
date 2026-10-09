import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDatabase, createVault } from './database.js';
import { emptyState, normalizeState } from './state.js';
const require=createRequire(import.meta.url);
export function requireStopped(filename){if(fs.existsSync(filename+'.lock'))throw new Error('请先停止网关。若曾异常退出，确认进程已停止后再处理遗留锁文件。');}
export function readSnapshot(filename,vault){
  requireStopped(filename);
  let state;
  if(/\.(sqlite|db)$/i.test(filename)){
    const {DatabaseSync}=require('node:sqlite'),sql=new DatabaseSync(filename,{readOnly:true});
    try{
      sql.exec('BEGIN');state=emptyState();Object.assign(state,JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data));
      for(const key of Object.keys(state).filter(k=>Array.isArray(state[k])))state[key]=sql.prepare(`SELECT data FROM "${key}" ORDER BY rowid`).all().map(row=>JSON.parse(row.data));
      sql.exec('COMMIT');
    }finally{sql.close();}
  }else state=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  state={...emptyState(),...state};normalizeState(state,vault);return state;
}
export function backupDatabase(filename,output,secret){
  const vault=createVault(secret),state=readSnapshot(filename,vault);
  const payload={format:'qcode-backup-v3',createdAt:new Date().toISOString(),state};
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  fs.writeFileSync(output,JSON.stringify({format:'qcode-encrypted-backup-v1',ciphertext:vault.encrypt(JSON.stringify(payload))}),{flag:'wx',mode:0o600});
  return {users:state.users.length,requests:state.requests.length};
}
export function restoreDatabase(input,target,secret){
  requireStopped(target);if(fs.existsSync(target))throw new Error('恢复目标已存在；请选择一个新文件，验证后再切换 DB_PATH');
  const vault=createVault(secret),wrapper=JSON.parse(fs.readFileSync(input,'utf8'));
  if(wrapper.format!=='qcode-encrypted-backup-v1')throw new Error('未知备份格式');
  const payload=JSON.parse(vault.decrypt(wrapper.ciphertext));
  if(payload.format!=='qcode-backup-v3')throw new Error('未知数据库快照格式');
  const state={...emptyState(),...payload.state};normalizeState(state,vault);
  // A restored database never resurrects old employee or administrator sessions.
  state.tokens=[];state.loginFailures=[];
  const db=createDatabase(target,{vault});
  try{db.transaction(next=>{for(const key of Object.keys(next))delete next[key];Object.assign(next,state);});}finally{db.close();}
  return {users:state.users.length,requests:state.requests.length};
}
export function migrateDatabase(source,target,secret){
  if(path.resolve(source)===path.resolve(target))throw new Error('迁移必须使用新的目标文件');
  requireStopped(source);requireStopped(target);if(fs.existsSync(target))throw new Error('迁移目标已存在');
  const vault=createVault(secret),state=readSnapshot(source,vault),db=createDatabase(target,{vault});
  try{db.transaction(next=>{for(const key of Object.keys(next))delete next[key];Object.assign(next,state);});}finally{db.close();}
  return {users:state.users.length,requests:state.requests.length};
}
export function archiveAudits(filename,output,secret,days){
  if(days!==undefined && (!Number.isInteger(days)||days<0))throw new Error('审计保留天数必须为非负整数；0 表示不归档');
  requireStopped(filename);const vault=createVault(secret),db=createDatabase(filename,{vault});
  try{
    days ??= db.read().settings.auditRetentionDays ?? 180;
    if(days===0)return {archived:0};
    const before=new Date(Date.now()-days*86400000).toISOString(),entries=db.read().audits.filter(a=>a.time<before);
    if(!entries.length)return {archived:0};
    fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
    fs.writeFileSync(output,JSON.stringify({format:'qcode-audit-archive-v1',ciphertext:vault.encrypt(JSON.stringify({before,entries}))}),{flag:'wx',mode:0o600});
    db.transaction(state=>{state.audits=state.audits.filter(a=>a.time>=before);});
    return {archived:entries.length};
  }finally{db.close();}
}
