import test from 'node:test';
import assert from 'node:assert/strict';
import {diffLines} from '../src/views/knowledge/components/ChangeComparison/diff.ts';

test('an inserted first line preserves following alignment and independent line numbers',()=>{
 const rows=diffLines('甲\n乙','新增\n甲\n乙');
 assert.equal(rows[0].before,undefined);
 assert.equal(rows[0].after.changed,true);
 assert.deepEqual(rows[1],{before:{number:1,text:'甲',changed:false},after:{number:2,text:'甲',changed:false}});
});
test('replacements, deletions and repeated lines retain complete text on both sides',()=>{
 for(const [before,after] of [['甲\n旧规则\n乙','甲\n新规则\n乙'],['甲\n甲\n乙','甲\n乙'],['','新增'],['删除',''],['甲\n乙\n','甲\n乙\n']]){
  const rows=diffLines(before,after);
  assert.equal(rows.filter(row=>row.before).map(row=>row.before.text).join('\n'),before);
  assert.equal(rows.filter(row=>row.after).map(row=>row.after.text).join('\n'),after);
 }
 assert.deepEqual(diffLines('',''),[]);
});
test('large fragmented changes bound alignment work without dropping any lines',()=>{
 const before=Array.from({length:1100},(_,i)=>'旧'+i).join('\n'),after=Array.from({length:1100},(_,i)=>'新'+i).join('\n');
 const rows=diffLines(before,after);
 assert.equal(rows.length,1100);
 assert.equal(rows.map(row=>row.before.text).join('\n'),before);
 assert.equal(rows.map(row=>row.after.text).join('\n'),after);
});
