import test from 'node:test';
import assert from 'node:assert/strict';
import { csv, filterRecords } from '../src/reports.js';
test('reports use local calendar boundaries and reject impossible dates',()=>{
  const records=[{started_at:'2026-10-08T16:01:00Z',username:'alice',user_id:2,status:'success'}];
  assert.equal(filterRecords(records,{from:'2026-10-09',to:'2026-10-09'},'Asia/Shanghai').length,1);
  assert.equal(filterRecords(records,{to:'2026-10-08'},'Asia/Shanghai').length,0);
  for(const from of ['2026-02-30','9999-99-99','not-a-date'])assert.throws(()=>filterRecords(records,{from},'Asia/Shanghai'));
  assert.equal(filterRecords(records,{userId:'3'},'Asia/Shanghai').length,0);
});
test('CSV exports neutralize spreadsheet formulas while preserving numeric amounts and quoted text',()=>{
  const output=csv([{name:' =HYPERLINK("bad")',amount:-12},{name:'a,"b"\nc',amount:4}],[['Name','name'],['Amount','amount']]);
  assert.ok(output.includes('"\' =HYPERLINK(""bad"")"'));
  assert.ok(output.includes('"-12"'));
  assert.ok(output.includes('"a,""b""\nc"'));
});
