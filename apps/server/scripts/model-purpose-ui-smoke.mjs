import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
const { chromium } = createRequire(import.meta.url)(process.env.QCODE_TEST_PLAYWRIGHT_MODULE || 'playwright');
await fs.cp(new URL('../../admin/dist/', import.meta.url), new URL('../public/console/', import.meta.url), { recursive: true });
const upstream = http.createServer((_req, res) => res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({data:[
  {id:'gpt-image-2',output_modalities:['image']}, {id:'vision-test',input_modalities:['text','image']},
]})));
upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
const db = createDatabase(), app = createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'browser-test-password'}, db);
const server = http.createServer(app); server.listen(0,'127.0.0.1'); await once(server,'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true,...(process.platform === 'win32' ? {channel:'msedge'} : {})});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin+'/login');
  await page.getByLabel('账号',{exact:true}).fill('admin');
  await page.getByLabel('密码',{exact:true}).fill('browser-test-password');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('heading',{name:'工作台概览',exact:true}).waitFor();
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qcode.admin.session')).token);
  await page.goto(origin+'/manage/models');
  await page.getByText('暂无服务来源，请先添加来源',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'配置图片能力',exact:true}).count(),0);
  const response = await page.request.post(origin+'/admin/models/sources/create',{headers:{Authorization:'Bearer '+token},data:{name:'图片测试站',kind:'relay',baseUrl:'http://127.0.0.1:'+upstream.address().port,apiKey:'synthetic-key',autoSync:false}});
  assert.equal(response.status(),201);
  await page.reload(); await page.getByRole('tab',{name:/中转站/}).click();
  const source = await response.json();
  const route = origin+'/admin/models/sources/'+source.id;
  const headers = {Authorization:'Bearer '+token};
  assert.equal((await page.request.post(route+'/sync',{headers,data:{}})).status(),200);
  for (const data of [
    {upstreamModel:'gpt-image-2',imagePrice:0},
    {upstreamModel:'vision-test',contextWindow:131072,inputPrice:0,cachedInputPrice:0,outputPrice:0},
  ]) assert.equal((await page.request.post(route+'/models',{headers,data})).status(),201);
  await page.reload(); await page.getByRole('tab',{name:/中转站/}).click();
  await page.getByRole('heading',{name:'图片测试站',exact:true}).click();
  const row = name => page.locator('.el-table__row').filter({hasText:name});
  await row('gpt-image-2').getByText('生图能力',{exact:true}).waitFor();
  assert.equal(await row('gpt-image-2').getByRole('button',{name:'验证',exact:true}).count(),0);
  const models = db.read().models.filter(model => model.source_id === source.id);
  const assign = (upstream, data) => page.request.post(origin+'/admin/models/'+models.find(model => model.upstream_model === upstream).id+'/purpose',{headers,data});
  assert.equal((await assign('gpt-image-2',{purpose:'image_generation',dailyImagesPerUser:3})).status(),200);
  assert.equal((await assign('vision-test',{purpose:'vision'})).status(),200);
  await page.reload(); await page.getByRole('tab',{name:/中转站/}).click();
  await page.getByRole('heading',{name:'图片测试站',exact:true}).click();
  await row('gpt-image-2').getByText('生图模型',{exact:true}).waitFor();
  await row('vision-test').getByText('识图模型',{exact:true}).waitFor();
  assert.equal(db.read().settings.imageGeneration.dailyImagesPerUser,3);
  assert.deepEqual(errors,[]);
  console.log('Model capability and assigned purpose labels passed.');
} finally {
  await browser.close(); server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close();
}
