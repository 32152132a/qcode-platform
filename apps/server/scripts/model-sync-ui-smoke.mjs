import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database.js'
const { chromium } = createRequire(import.meta.url)(process.env.QCODE_TEST_PLAYWRIGHT_MODULE || 'playwright')
await fs.cp(
  new URL('../../admin/dist/', import.meta.url),
  new URL('../public/console/', import.meta.url),
  { recursive: true }
)
const db = createDatabase()
const app = createApp(
  {
    encryptionSecret: 'a'.repeat(64),
    adminUsername: 'admin',
    adminPassword: 'browser-test-password',
    timeoutMs: 5000,
  },
  db
)
const server = http.createServer(app)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = 'http://127.0.0.1:' + server.address().port
let failCatalog = false
const upstream = http.createServer((_req, res) =>
  res.writeHead(failCatalog ? 503 : 200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      data: [
        ...Array.from({ length: 45 }, (_, i) => ({ id: 'model-' + i })),
        { id: 'claude-opus-5-5' },
        { id: 'text-embedding-3' },
      ],
    })
  )
)
upstream.listen(0, '127.0.0.1')
await once(upstream, 'listening')
const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin + '/login')
  await page.getByLabel('账号', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('heading', { name: '工作台概览', exact: true }).waitFor()
  const token = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('qcode.admin.session')).token
  )
  const response = await page.request.post(origin + '/admin/models/sources/create', {
    headers: { Authorization: 'Bearer ' + token },
    data: {
      kind: 'relay',
      name: '选择测试站',
      baseUrl: 'http://127.0.0.1:' + upstream.address().port,
      apiKey: 'fake-selection-key',
      autoSync: false,
    },
  })
  assert.equal(response.status(), 201)
  const source = await response.json()
  await page.goto(origin + '/manage/models')
  await page.getByRole('tab', { name: /中转站/ }).click()
  const add = page.getByRole('button', { name: '添加模型', exact: true })
  await page.getByRole('heading', { name: '选择测试站', exact: true }).click()
  await add.click()
  const dialog = page.getByRole('dialog', { name: '添加模型 · 选择测试站' })
  const read = dialog.getByRole('button', { name: '读取上游目录' })
  await read.click()
  const select = dialog.getByRole('combobox', { name: '选择上游模型' })
  await select.click()
  await select.fill('claude-opus-5-5')
  await page.getByRole('option', { name: 'claude-opus-5-5', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText('请填写上下文长度', { exact: true }).waitFor()
  await dialog.getByRole('spinbutton', { name: '上下文长度', exact: true }).fill('131072')
  for (const name of ['每百万普通输入 Token 单价', '每百万缓存输入 Token 单价', '每百万输出 Token 单价'])
    await dialog.getByRole('spinbutton', { name, exact: true }).fill('0')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const saved = db.read().models.filter(model => model.source_id === source.id)
  assert.deepEqual(saved.map(model => model.upstream_model), ['claude-opus-5-5'])
  assert.equal(saved[0].active, false)
  failCatalog = true
  await add.click()
  await read.click()
  await dialog.getByText(/暂无可用 Key/).waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log('MODEL SYNC UI passed: single selection, required fields, save and catalog failure')
} finally {
  await browser.close()
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  db.close()
}
