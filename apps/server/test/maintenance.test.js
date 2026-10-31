import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase,createVault } from '../src/database.js';
import { backupDatabase,restoreDatabase,archiveAudits } from '../src/maintenance.js';
test('encrypted backup restores users and accounting, invalidates sessions, and rejects wrong keys',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-backup-')),source=path.join(root,'source.sqlite'),backup=path.join(root,'backup'),target=path.join(root,'new.sqlite'),secret='b'.repeat(64);
  try{
    const db=createDatabase(source,{vault:createVault(secret)});
    db.transaction(s=>{s.users.push({id:1,username:'staff',role:'user'});s.tokens.push({token_hash:'old',user_id:1,expires_at:'2999-01-01'});s.requests.push({id:'r',status:'success',total_tokens:50});});
    assert.throws(()=>backupDatabase(source,backup,secret),/locked/);db.close();
    backupDatabase(source,backup,secret);assert.doesNotMatch(fs.readFileSync(backup,'utf8'),/staff/);
    assert.throws(()=>restoreDatabase(backup,target,'a'.repeat(64)));assert.equal(fs.existsSync(target),false);
    restoreDatabase(backup,target,secret);const restored=createDatabase(target,{vault:createVault(secret)});
    assert.equal(restored.read().users[0].username,'staff');assert.equal(restored.read().tokens.length,0);assert.equal(restored.read().requests[0].total_tokens,50);restored.close();
    assert.throws(()=>restoreDatabase(backup,target,secret),/已存在/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('audit archive preserves all accounting',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-migration-')),source=path.join(root,'source.sqlite'),archive=path.join(root,'audit.json'),secret='a'.repeat(64);
  try{
    const db=createDatabase(source);db.transaction(s=>{s.audits.push({id:'old',time:'2000-01-01',action:'test'});s.requests.push({id:'r',status:'success',total_tokens:10});});db.close();
    assert.equal(archiveAudits(source,archive,secret,180).archived,1);
    const migrated=createDatabase(source,{vault:createVault(secret)});assert.equal(migrated.read().requests.length,1);assert.equal(migrated.read().audits.length,0);migrated.close();
    assert.equal(JSON.parse(createVault(secret).decrypt(JSON.parse(fs.readFileSync(archive,'utf8')).ciphertext)).entries.length,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
