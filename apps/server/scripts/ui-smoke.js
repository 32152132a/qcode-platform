import { createRequire } from 'node:module';
import { once } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { createMockModelServer } from './mock-model.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QCODE_PLAYWRIGHT_MODULE || 'playwright');
const mock = createMockModelServer(); mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const db = createDatabase();
const app = createApp({ encryptionSecret: 'a'.repeat(64), adminUsername: 'admin', adminPassword: 'ui-test-password',
  baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, upstreamModel: 'mock-model', publicModel: 'qcode-model', upstreamKey: 'mock-local-key' }, db);
const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
let page;
try {
  browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('ui-test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '部门管理', exact: true }).click();
  await page.getByRole('button', { name: '创建部门', exact: true }).click();
  await page.getByRole('dialog').getByLabel('部门名称', {exact:true}).fill('研发部');
  await page.getByRole('dialog').getByRole('button', {name:'保存',exact:true}).click();
  await page.getByRole('cell', {name:'研发部',exact:true}).waitFor();
  await page.getByRole('button', { name: '用户管理', exact: true }).click();
  await page.getByRole('button', { name: '创建用户', exact: true }).waitFor();
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('用户名', { exact: true }).fill('employee');
  await dialog.getByLabel('初始密码（至少 10 位）').fill('employee-password');
  await dialog.getByLabel('分配 Key').selectOption({ index: 1 });
  await dialog.getByLabel('部门', {exact:true}).selectOption({index:1});
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('cell', { name: 'employee / 研发部', exact: true }).waitFor();
  const employeeRow = page.getByRole('row').filter({ hasText: 'employee / 研发部' });
  await employeeRow.getByRole('button', { name: '禁用', exact: true }).click();
  await employeeRow.getByRole('button', { name: '启用', exact: true }).waitFor();
  await employeeRow.getByRole('button', { name: '启用', exact: true }).click();
  await employeeRow.getByRole('button', { name: '禁用', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Key 管理', exact: true }).click();
  await page.getByRole('button', { name: '检查', exact: true }).click();
  await page.getByRole('cell', { name: 'reachable', exact: true }).waitFor();
  await page.getByRole('button',{name:'共享 Skill',exact:true}).click();
  await page.getByRole('button',{name:'发布 Skill',exact:true}).click();
  await dialog.getByLabel('标识名称（小写字母、数字和短横线）',{exact:true}).fill('team-review');
  await dialog.getByLabel('用途说明',{exact:true}).fill('团队代码检查');
  await dialog.getByLabel('Skill 指令内容（Markdown）',{exact:true}).fill('检查改动并运行相关测试。');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('cell',{name:'team-review',exact:true}).waitFor();
  await page.getByRole('button',{name:'系统设置',exact:true}).click();
  await page.getByRole('button',{name:'修改设置',exact:true}).click();
  await dialog.getByLabel('组织名称',{exact:true}).fill('团队测试平台');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('cell',{name:'团队测试平台',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'用户管理',exact:true}).waitFor();
  for (const name of ['工作台概览','模型配置','部门管理','共享 Skill','系统设置', '用量统计', '请求日志', '操作审计', '系统状态', '用户管理']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.waitForFunction(() => !document.getElementById('content').textContent.includes('加载中'));
  }
  fs.mkdirSync('.visual-tests', { recursive: true });
  await page.screenshot({ path: '.visual-tests/admin-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.visual-tests/admin-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  console.log('UI smoke passed: login, create user, disable/enable, key check, eleven tabs, desktop/mobile, logout.');
} catch (error) {
  if (page) console.error((await page.locator('body').innerText()).slice(0, 4000));
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections(); mock.closeAllConnections(); server.close(); mock.close(); db.close();
}
