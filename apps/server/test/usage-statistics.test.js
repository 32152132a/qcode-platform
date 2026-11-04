import test from 'node:test';
import assert from 'node:assert/strict';
import { statistics } from '../src/proxy.js';
import { filterRecords } from '../src/reports.js';

test('usage distinguishes actual tokens, unknown usage, pending requests and currency-separated costs',()=>{
  const rows=[
    {user_id:1,username:'a',model_id:'m1',model:'one',started_at:'2026-10-13T16:30:00Z',status:'success',total_tokens:100,charged_tokens:100,cost_micros:1500000,currency:'USD'},
    {user_id:2,username:'b',model_id:'m2',model:'two',started_at:'2026-10-14T01:00:00Z',status:'interrupted',total_tokens:null,reserved_tokens:200,cost_micros:null},
    {user_id:1,username:'a',model_id:'m1',model:'one',started_at:'2026-10-14T02:00:00Z',status:'pending',reserved_tokens:50},
    {user_id:2,username:'b',model_id:'m2',model:'two',started_at:'2026-10-12T12:00:00Z',status:'success',total_tokens:0,charged_tokens:0,cost_micros:2000000,currency:'CNY'},
  ];
  const result=statistics({requests:rows},'Asia/Shanghai');
  assert.equal(result.totals.tokens,100);assert.equal('chargedTokens' in result.totals,false);
  assert.equal('conservativeTokens' in result.totals,false);assert.equal(result.totals.unknownUsage,1);
  assert.equal(result.totals.success,2);assert.equal(result.totals.failed,1);assert.equal(result.totals.pending,1);
  assert.deepEqual(result.totals.costs,{USD:1.5,CNY:2});assert.equal(result.totals.unknownCost,2);
  assert.equal(result.models.length,2);assert.equal(result.users[0].username,'a');
  assert.equal(result.days.find(row=>row.date==='2026-10-14').requests,3);
  const filtered=filterRecords(rows,{from:'2026-10-14',to:'2026-10-14'},'Asia/Shanghai');
  assert.equal(filtered.length,3);assert.deepEqual(statistics({requests:filtered},'Asia/Shanghai').totals.costs,{USD:1.5});
  assert.throws(()=>filterRecords(rows,{from:'2026-02-30'},'Asia/Shanghai'));
  assert.throws(()=>filterRecords(rows,{from:'2026-10-14',to:'2026-10-13'},'Asia/Shanghai'));
});
test('empty usage keeps finite zero totals and empty dimensions',()=>{
  const result=statistics({requests:[]},'Asia/Shanghai');
  assert.equal(result.totals.tokens,0);assert.equal(result.totals.unknownUsage,0);
  assert.deepEqual(result.models,[]);assert.deepEqual(result.days,[]);assert.deepEqual(result.totals.costs,{});
});

test('historical estimates never consume quota or inflate actual statistics; pending holds are temporary', async()=>{
 const {consumption,quotas}=await import('../src/domain.js');
 const user={id:1,quotas:quotas()};
 const rows=[
 {user_id:1,started_at:'2026-10-31T01:00:00Z',status:'failed',total_tokens:null,charged_tokens:90000,reserved_tokens:90000},
 {user_id:1,started_at:'2026-10-31T01:00:00Z',status:'success',input_tokens:10,output_tokens:20,total_tokens:30,charged_tokens:90000},
 {user_id:1,started_at:'2026-10-31T01:00:00Z',status:'pending',reserved_tokens:100},
 ];
 const state={requests:rows};
 assert.equal(consumption(state,user,'Asia/Shanghai').totalTokens,130);
 assert.equal(statistics(state,'Asia/Shanghai').totals.tokens,30);
 assert.equal(statistics(state,'Asia/Shanghai').totals.inputTokens,10);
 rows[2].status='cancelled';
 assert.equal(consumption(state,user,'Asia/Shanghai').totalTokens,30);
 assert.equal(rows[0].charged_tokens,90000,'historical raw values are preserved');
 assert.deepEqual(filterRecords(rows,{status:'errors'},'Asia/Shanghai').map(r=>r.status),['failed','cancelled']);
 assert.equal(filterRecords([{...rows[0],model_id:'one'}, {...rows[1],model_id:'two'}],{modelId:'two'},'Asia/Shanghai').length,1);
});
