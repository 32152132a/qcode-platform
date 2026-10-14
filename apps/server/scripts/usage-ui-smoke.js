import { createRequire } from 'node:module';
import { once } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.QCODE_PLAYWRIGHT_MODULE || 'playwright');
const db=createDatabase();
const app=createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'ui-test-password',baseUrl:'http://127.0.0.1:9/v1',upstreamModel:'mock',publicModel:'qcode',upstreamKey:'mock-local-key'},db);
db.transaction(state=>{state.requests.push(
  {id:'one',user_id:1,username:'admin',model_id:'m1',model:'model-a',started_at:'2026-10-14T01:00:00Z',status:'success',total_tokens:100,charged_tokens:100,cost_micros:1500000,currency:'USD'},
  {id:'two',user_id:2,username:'employee',model_id:'m2',model:'model-b',started_at:'2026-10-14T02:00:00Z',status:'failed',total_tokens:null,reserved_tokens:200,cost_micros:null},
  {id:'three',user_id:1,username:'admin',model_id:'m1',model:'model-a',started_at:'2026-10-12T01:00:00Z',status:'success',total_tokens:50,charged_tokens:50,cost_micros:2000000,currency:'CNY'}
);});
const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'管理员登录',exact:true}).click();
  await page.getByLabel('密码',{exact:true}).fill('ui-test-password');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:'用量统计',exact:true}).click();
  await page.getByRole('heading',{name:'每日 Token 趋势'}).waitFor();
  assert.match(await page.locator('.usage-dashboard').innerText(),/USD 1.500000.*CNY 2.000000/);
  assert.equal(await page.locator('.usage-day').count(),3);
  fs.mkdirSync('.visual-tests',{recursive:true});
  await page.screenshot({path:'.visual-tests/usage-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'.visual-tests/usage-mobile.png',fullPage:true});
  await page.getByLabel('开始日期',{exact:true}).fill('2026-10-14');
  await page.getByLabel('结束日期',{exact:true}).fill('2026-10-14');
  await page.getByRole('button',{name:'应用日期'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.usage-day').length===1);
  assert.doesNotMatch(await page.locator('.usage-dashboard').innerText(),/CNY 2.000000/);
  await page.getByLabel('开始日期',{exact:true}).fill('2027-01-01');
  await page.getByLabel('结束日期',{exact:true}).fill('2027-01-02');
  await page.getByRole('button',{name:'应用日期'}).click();
  await page.getByText('所选日期范围暂无请求，请调整日期筛选。',{exact:true}).waitFor();
  await page.screenshot({path:'.visual-tests/usage-empty-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Usage UI passed: dates, currencies, zero-day trend, responsive layout and empty state.');
}finally{await browser?.close();server.closeAllConnections();server.close();db.close();}
