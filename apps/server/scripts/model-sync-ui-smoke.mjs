import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
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
  await page.getByRole('button', { name: '同步模型', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '同步模型 · 选择测试站' })
  await dialog.getByText('model-0', { exact: true }).click()
  await dialog.getByRole('button', { name: '下一页', exact: true }).click()
  await dialog.getByText('model-12', { exact: true }).click()
  const search = dialog.getByPlaceholder('输入模型名称或版本')
  await search.fill('claude-opus-5-5')
  await dialog.getByText('claude-opus-5-5', { exact: true }).click()
  await search.fill('model-0')
  assert(await dialog.getByRole('checkbox', { name: 'model-0', exact: true }).isChecked())
  await search.fill('text-embedding')
  assert(await dialog.getByRole('checkbox', { name: 'text-embedding-3', exact: true }).isDisabled())
  await search.fill('')
  await fs.mkdir('.visual-tests', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const bounds = await dialog.evaluate((el) => {
      const panel = el.matches('.el-dialog') ? el : el.querySelector('.el-dialog')
      return { width: panel.clientWidth, scroll: panel.scrollWidth }
    })
    assert(bounds.scroll <= bounds.width + 2, JSON.stringify({ width, ...bounds }))
    assert(bounds.width <= 640 && bounds.width <= width - 24, JSON.stringify({ width, ...bounds }))
    await page.screenshot({ path: '.visual-tests/model-sync-' + width + '.png', fullPage: true })
  }
  await dialog.getByRole('button', { name: '导入所选模型（3）', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const saved = db.read().models.filter((model) => model.source_id === source.id)
  assert.deepEqual(
    saved.map((model) => model.upstream_model).sort(),
    ['claude-opus-5-5', 'model-0', 'model-12'].sort()
  )
  assert(saved.every((model) => !model.active))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '同步模型', exact: true }).click()
  await dialog.getByText('model-0', { exact: true }).waitFor()
  assert(await dialog.getByRole('checkbox', { name: 'model-0', exact: true }).isDisabled())
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(db.read().models.filter((model) => model.source_id === source.id).length, 3)
  failCatalog = true
  await page.getByRole('button', { name: '同步模型', exact: true }).click()
  await dialog.getByRole('button', { name: '重新读取', exact: true }).waitFor()
  failCatalog = false
  await dialog.getByRole('button', { name: '重新读取', exact: true }).click()
  await dialog.getByText('model-0', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(errors, [])
  console.log(
    'MODEL SYNC UI passed: search, cross-page selection, import beyond 30, existing/unsupported, cancel, retry, desktop/mobile layouts'
  )
} finally {
  await browser.close()
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  db.close()
}
