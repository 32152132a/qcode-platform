import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { secureStore } from '../../client/session-store.mjs';

test('Windows encrypted sessions atomically overwrite existing credentials and preserve Unicode',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-secure-store-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const file=path.join(root,'会话.json'),store=secureStore(file);
  for(let index=0;index<3;index++){
    const value={token:'synthetic-token-'+index,refreshToken:'synthetic-refresh-'+index,user:{id:17,username:'测试员工'},expiresAt:'2026-10-15T00:00:00Z'};
    store.write(value);assert.deepEqual(store.read(),value);
    const saved=fs.readFileSync(file,'utf8');assert.ok(!saved.includes(value.token));assert.ok(!saved.includes(value.refreshToken));
    assert.deepEqual(fs.readdirSync(root),['会话.json'],'atomic replacements remove temporary files');
  }
});
