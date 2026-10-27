import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createApp} from '../src/app.js';
import {createDatabase} from '../src/database.js';
const {chromium}=createRequire(import.meta.url)(process.env.QCODE_TEST_PLAYWRIGHT_MODULE||'playwright');
await fs.cp(new URL('../../admin/dist/',import.meta.url),new URL('../public/console/',import.meta.url),{recursive:true});
const db=createDatabase(),app=createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'browser-test-password',baseUrl:'http://127.0.0.1:1/v1',upstreamModel:'test-vision-model',publicModel:'test-vision-model'},db);
const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/login');await page.getByLabel('账号',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'工作台概览',exact:true}).waitFor();
 await page.goto(origin+'/manage/models');await page.getByRole('tab',{name:/中转站/}).click();await page.getByRole('button',{name:'配置图片能力',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'图片能力',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByRole('switch').count(),0);
 await dialog.locator('.el-select').nth(1).click();await page.getByRole('option',{name:'Default model',exact:true}).click();
 await fs.mkdir('.visual-tests',{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>!document.querySelector('[class*=dialog-fade-enter]'));const size=await dialog.evaluate(el=>{const panel=el.matches('.el-dialog')?el:el.querySelector('.el-dialog');return {width:panel.clientWidth,scroll:panel.scrollWidth}});assert(size.scroll<=size.width+2);assert(size.width<=width-24);await page.screenshot({path:'.visual-tests/vision-settings-'+width+'.png',fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(db.read().settings.imageGeneration.visionModelId,db.read().models[0].id);
 await page.reload();await page.getByRole('button',{name:'配置图片能力',exact:true}).click();await dialog.waitFor();
 assert.equal(await dialog.locator('.el-select').nth(1).innerText(),'Default model');
 await dialog.locator('.el-select').nth(1).hover();await dialog.locator('.el-select').nth(1).locator('.el-select__clear').click();
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(db.read().settings.imageGeneration.visionModelId,'');
 assert.deepEqual(errors,[]);console.log('Shared image settings contain no switches; default vision model saves, reloads and clears at desktop/mobile widths.');
}finally{await browser.close();server.closeAllConnections();server.close();}
