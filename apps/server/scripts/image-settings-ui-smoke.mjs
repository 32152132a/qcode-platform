import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
const { chromium } = createRequire(import.meta.url)(process.env.QCODE_TEST_PLAYWRIGHT_MODULE || 'playwright');
await fs.cp(new URL('../../admin/dist/',import.meta.url),new URL('../public/console/',import.meta.url),{recursive:true});
const db=createDatabase(),app=createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'browser-test-password'},db);
const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/login');await page.getByLabel('账号',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'工作台概览',exact:true}).waitFor();
 const token=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qcode.admin.session')).token);
 const response=await page.request.post(origin+'/admin/models/sources/create',{headers:{Authorization:'Bearer '+token},data:{name:'生图测试站',kind:'relay',baseUrl:'https://image.example/v1',apiKey:'synthetic-key',autoSync:false}});assert.equal(response.status(),201);
 await page.goto(origin+'/manage/models');await page.getByRole('button',{name:'配置生图',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'对话生图',exact:true});await dialog.waitFor();await page.waitForFunction(()=>!document.querySelector('[class*=dialog-fade-enter]'));
 await dialog.locator('.el-select').nth(0).click();await page.getByRole('option',{name:'开启',exact:true}).click();
 await dialog.locator('.el-select').nth(1).click();await page.getByRole('option',{name:'生图测试站',exact:true}).click();
 await dialog.getByPlaceholder('请输入生图模型',{exact:true}).fill('gpt-image-2');
 await dialog.getByPlaceholder('请输入每人每日张数',{exact:true}).fill('3');await dialog.getByText('生图模型',{exact:true}).click();
 await fs.mkdir('.visual-tests',{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const bounds=await dialog.evaluate(el=>{const panel=el.matches('.el-dialog')?el:el.querySelector('.el-dialog');return {width:panel.clientWidth,scroll:panel.scrollWidth}});assert(bounds.scroll<=bounds.width+2);assert(bounds.width<=640&&bounds.width<=width-24,JSON.stringify({viewport:width,...bounds}));await page.screenshot({path:'.visual-tests/image-settings-'+width+'.png',fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByText('对话生图：gpt-image-2 · 每人每日最多 3 张',{exact:true}).waitFor();
 assert.equal(db.read().settings.imageGeneration.dailyImagesPerUser,3);
 await page.reload();await page.getByText('对话生图：gpt-image-2 · 每人每日最多 3 张',{exact:true}).waitFor();
 db.transaction(state=>{state.settings.modelSources[0].active=false});
 await page.reload();await page.getByText('对话生图暂不可用：站点已停用、删除或未配置 Key',{exact:true}).waitFor();
 await page.getByRole('button',{name:'配置生图',exact:true}).click();await dialog.waitFor();
 await dialog.locator('.el-select').nth(0).click();await page.getByRole('option',{name:'关闭',exact:true}).click();
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(db.read().settings.imageGeneration.enabled,false);await page.getByText('对话生图未启用',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Image settings save, reload, disabled-source notice and switch-off passed at desktop and mobile widths.');
}finally{await browser.close();server.closeAllConnections();server.close();}
