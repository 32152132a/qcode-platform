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
  await page.getByText('暂无服务来源，添加后可读取列表并选择模型导入',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'配置图片能力',exact:true}).count(),0);
  const response = await page.request.post(origin+'/admin/models/sources/create',{headers:{Authorization:'Bearer '+token},data:{name:'图片测试站',kind:'relay',baseUrl:'http://127.0.0.1:'+upstream.address().port,apiKey:'synthetic-key',autoSync:false}});
  assert.equal(response.status(),201);
  await page.reload(); await page.getByRole('tab',{name:/中转站/}).click();
  await page.getByRole('button',{name:'同步模型',exact:true}).click();
  const sync = page.getByRole('dialog',{name:/同步模型/});
  await sync.getByText('生图',{exact:true}).waitFor();
  await sync.getByText('识图',{exact:true}).waitFor();
  await sync.locator('.el-checkbox').filter({hasText:'gpt-image-2'}).click();
  await sync.locator('.el-checkbox').filter({hasText:'vision-test'}).click();
  await sync.getByRole('button',{name:'导入所选模型（2）',exact:true}).click();
  await sync.waitFor({state:'hidden'});
  const row = name => page.locator('.el-table__row').filter({hasText:name});
  await row('gpt-image-2').getByRole('button',{name:'设置用途',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'设置模型用途',exact:true});
  await dialog.locator('.el-select').click();
  await page.getByRole('option',{name:'设为生图模型',exact:true}).click();
  await dialog.getByText('高级设置',{exact:true}).click();
  await dialog.getByPlaceholder('请输入每人每日生图张数').fill('3');
  await fs.mkdir('.visual-tests',{recursive:true});
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    const bounds = await dialog.evaluate(el => { const panel = el.matches('.el-dialog') ? el : el.querySelector('.el-dialog'); return {width:panel.clientWidth,scroll:panel.scrollWidth}; });
    assert(bounds.width <= 520 && bounds.width <= width - 24 && bounds.scroll <= bounds.width + 2, JSON.stringify(bounds));
    await page.screenshot({path:'.visual-tests/model-purpose-'+width+'.png',fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await dialog.getByRole('button',{name:'确认',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await row('gpt-image-2').getByText('生图模型',{exact:true}).waitFor();
  assert.equal(db.read().settings.imageGeneration.dailyImagesPerUser,3);
  assert.equal(await row('gpt-image-2').getByRole('button',{name:'验证',exact:true}).count(),0);
  await row('vision-test').getByRole('button',{name:'设置用途',exact:true}).click();
  await dialog.locator('.el-select').click();
  await page.getByRole('option',{name:'设为识图模型',exact:true}).click();
  await dialog.getByRole('button',{name:'确认',exact:true}).click(); await dialog.waitFor({state:'hidden'});
  await row('vision-test').getByText('识图模型',{exact:true}).waitFor();
  await page.reload(); await page.getByRole('tab',{name:/中转站/}).click();
  await row('vision-test').getByText('识图模型',{exact:true}).waitFor();
  await row('gpt-image-2').getByRole('button',{name:'设置用途',exact:true}).click();
  await dialog.locator('.el-select').click(); await page.getByRole('option',{name:'取消当前用途',exact:true}).click();
  await dialog.getByRole('button',{name:'确认',exact:true}).click(); await dialog.waitFor({state:'hidden'});
  assert.equal(db.read().settings.imageGeneration.enabled,false);
  assert(db.read().settings.imageGeneration.visionModelId);
  assert.deepEqual(errors,[]);
  console.log('Model sync capability labels, purpose assignment, reload, cancellation and desktop/mobile dialog widths passed.');
} finally {
  await browser.close(); server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close();
}
