import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/database.js'
const { chromium } = createRequire(import.meta.url)(process.env.QCODE_TEST_PLAYWRIGHT_MODULE)
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
const browser = await chromium.launch({ channel: 'msedge', headless: true })
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
  const headers = { Authorization: 'Bearer ' + token }
  for (let i = 0; i < 31; i++) {
    const response = await page.request.post(origin + '/admin/users', {
      headers,
      data: { username: 'component-user-' + i, password: 'fixture-password-123' },
    })
    assert.equal(response.status(), 201)
  }
  await page.goto(origin + '/manage/users')
  const table = page.locator('.data-table').first(),
    rows = table.locator('.el-table__body-wrapper .el-table__row')
  await rows.first().waitFor()
  assert.equal(await rows.count(), 10)
  const header = table.locator('.el-table__header-wrapper')
  const initial = await header.boundingBox()
  await table.locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate((el) => {
    el.scrollTop = 240
  })
  assert.equal((await header.boundingBox()).y, initial.y)
  await table.getByRole('button', { name: '下一页', exact: true }).click()
  await table.getByRole('button', { name: '下一页', exact: true }).click()
  const search = table.getByPlaceholder('搜索当前列表')
  await search.fill('component-user-29')
  await rows.filter({ hasText: 'component-user-29' }).waitFor()
  assert.equal(await rows.count(), 1)
  assert.equal((await table.locator('.el-pager .is-active').innerText()).trim(), '1')
  const previous = page.url()
  await search.press('Enter')
  assert.equal(page.url(), previous)
  await search.fill('')
  await table.locator('.el-pagination .el-select__wrapper').click()
  await page.getByRole('option', { name: /20.*条/ }).click()
  assert.equal(await rows.count(), 20)
  await table.getByRole('button', { name: '下一页', exact: true }).click()
  db.transaction((state) => {
    state.users = state.users.filter(
      (user) => user.username === 'admin' || user.username === 'component-user-0'
    )
  })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await rows.filter({ hasText: 'component-user-0' }).waitFor()
  assert.equal((await table.locator('.el-pager .is-active').innerText()).trim(), '1')
  const login = await page.request.post(origin + '/auth/login', {
    data: {
      username: 'component-user-0',
      password: 'fixture-password-123',
      device: '组件验收设备',
    },
  })
  assert.equal(login.status(), 200)
  await search.fill('component-user-0')
  await table.getByRole('button', { name: '登录设备', exact: true }).click()
  const devices = page.getByRole('dialog', { name: '登录设备', exact: true })
  await devices.getByText('组件验收设备', { exact: true }).waitFor()
  assert.equal(await devices.locator('.el-pagination').count(), 1)
  await devices.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await devices.getByText('暂无数据', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  db.transaction((state) => {
    for (let i = 0; i < 60; i++)
      state.audits.push({
        id: 'fixture-audit-' + i,
        time: new Date().toISOString(),
        actor: 'admin',
        action: 'fixture.action',
        target: String(i),
      })
  })
  await page.goto(origin + '/manage/audits')
  assert.equal(await page.locator('.el-pagination').count(), 1)
  const auditPage = page.waitForResponse((response) =>
    response.url().includes('/admin/audits?offset=25&limit=25')
  )
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await auditPage
  assert.equal(await page.locator('.el-table__body-wrapper .el-table__row').count(), 25)
  assert.equal(await page.getByPlaceholder('搜索当前列表').count(), 0)
  await page.getByPlaceholder('搜索用户、模型或操作').fill('fixture.action')
  const filterPage = page.waitForResponse(
    (response) =>
      response.url().includes('/admin/audits?offset=0&limit=25') &&
      response.url().includes('search=fixture.action')
  )
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await filterPage
  const sourceResponse = await page.request.post(origin + '/admin/models/sources', {
    headers,
    data: {
      name: '组件模型服务',
      kind: 'local',
      baseUrl: 'http://127.0.0.1:11434/v1',
      autoSync: false,
    },
  })
  assert.equal(sourceResponse.status(), 201)
  const source = await sourceResponse.json()
  const modelResponse = await page.request.post(
    origin + '/admin/models/sources/' + source.id + '/models',
    { headers, data: { name: '组件回归模型', upstreamModel: 'qwen:0.5b' } }
  )
  assert.equal(modelResponse.status(), 201)
  const model = await modelResponse.json()
  await page.goto(origin + '/manage/models')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const modelDialog = page.getByRole('dialog', { name: '配置模型', exact: true })
  const name = modelDialog.getByLabel('显示名称', { exact: true })
  await name.fill('')
  await modelDialog.getByRole('button', { name: '保存', exact: true }).click()
  assert(await modelDialog.isVisible())
  await name.fill('组件配置已保存')
  assert(await modelDialog.getByLabel('上游模型', { exact: true }).isDisabled())
  await modelDialog.getByText('高级配置', { exact: true }).click()
  await modelDialog.getByRole('spinbutton', { name: '上下文长度', exact: true }).fill('65536')
  await modelDialog.getByRole('spinbutton', { name: '最大输出 Token', exact: true }).fill('512')
  await modelDialog.getByRole('switch', { name: '请求流式用量', exact: true }).locator('..').click()
  await modelDialog.getByRole('button', { name: '保存', exact: true }).click()
  await modelDialog.waitFor({ state: 'hidden' })
  const saved = db.read().models.find((item) => item.id === model.id)
  assert.equal(saved.name, '组件配置已保存')
  assert.equal(saved.context_window, 65536)
  assert.equal(saved.max_output_tokens, 512)
  assert.equal(saved.stream_usage, false)
  await page.goto(origin + '/manage/knowledge')
  const knowledge = page.getByPlaceholder('搜索知识库内容')
  await knowledge.fill('组件检索')
  let response = page.waitForResponse((item) => item.url().includes('/admin/knowledge/search?q='))
  await page.getByRole('button', { name: '检索', exact: true }).click()
  await response
  response = page.waitForResponse((item) => item.url().includes('/admin/knowledge/search?q='))
  await knowledge.press('Enter')
  await response
  await fs.mkdir('.visual-tests', { recursive: true })
  for (const route of ['users', 'audits', 'knowledge', 'models'])
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(origin + '/manage/' + route)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await page.waitForTimeout(150)
      const size = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      assert(size.scroll <= size.width + 2, route + JSON.stringify(size))
      await page.screenshot({
        path: '.visual-tests/reuse-' + route + '-' + width + '.png',
        fullPage: true,
      })
    }
  assert.deepEqual(errors, [])
  console.log(
    'COMPONENT REUSE passed: paging, search reset, resize, clamp, fixed header, device revocation, server pagination, model form save, knowledge search, desktop/mobile layouts'
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  db.close()
}
