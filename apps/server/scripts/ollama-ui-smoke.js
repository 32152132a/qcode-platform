import {createRequire} from 'node:module';
import {once} from 'node:events';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createApp} from '../src/app.js';
import {createDatabase} from '../src/database.js';
const {chromium}=createRequire(import.meta.url)(process.env.QCODE_PLAYWRIGHT_MODULE || 'playwright');
const upstream=http.createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,undefined);
 if(req.url==='/v1/models')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qwen:0.5b'}]}));
 res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'OK'}}],usage:{prompt_tokens:4,completion_tokens:1,total_tokens:5}})+'\n\ndata: [DONE]\n\n');
});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const app=createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'ui-test-password',ollamaBaseUrl:`http://127.0.0.1:${upstream.address().port}/v1`},createDatabase());
const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'管理员登录',exact:true}).click();await page.getByLabel('密码',{exact:true}).fill('ui-test-password');await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('button',{name:'模型配置',exact:true}).click();await page.getByRole('button',{name:'配置',exact:true}).click();
 assert.equal(await page.getByLabel('默认 Key（来自 Key 管理）').isDisabled(),true);
 await page.getByRole('button',{name:'读取服务支持的模型列表'}).click();await page.getByText('已读取 1 个模型，在上游模型输入框中选择。',{exact:true}).waitFor();
 await page.getByLabel('服务来源').selectOption('ollama');await page.waitForFunction(()=>document.querySelector('[name=upstreamModel]')?.value==='qwen:0.5b');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'测试聊天连通性',exact:true}).click();await page.getByText('聊天连通 · 工具未验证',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);fs.mkdirSync('.visual-tests',{recursive:true});await page.screenshot({path:'.visual-tests/ollama-model-mobile.png',fullPage:true});
 console.log('Ollama UI passed: preset, keyless catalogue, save, text connectivity, honest badge and mobile layout.');
}finally{await browser?.close();server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();}
