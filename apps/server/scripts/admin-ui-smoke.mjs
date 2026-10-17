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
  assert.equal(await page.getByRole('heading', { name: '员工安装即用，团队统一管理' }).count(), 0)
  await page.getByRole('menuitem', { name: '用户管理', exact: true }).click()
  await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor()
  await page.goto(origin + '/missing-page-test')
  await page.getByText('抱歉，您访问的页面不存在', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await page.getByRole('heading', { name: '员工安装即用，团队统一管理', exact: true }).waitFor()
  console.log('NAVIGATION, HOMEPAGE AND 404 passed')
  const pages = {
    users: '用户管理',
    models: '模型与服务',
    keys: 'Key 管理',
    departments: '部门管理',
    skills: '共享 Skill',
    knowledge: '团队知识库',
    usage: '用量统计',
    requests: '请求日志',
    audits: '操作审计',
    settings: '系统设置',
    system: '系统状态',
  }
  for (const [route, title] of Object.entries(pages)) {
    await page.goto(origin + '/manage/' + route)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    await page.waitForTimeout(100)
    console.log('PAGE', route, 'passed')
  }
  await page.goto(origin + '/manage/users')
  await page.getByRole('button', { name: '创建用户', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('账号', { exact: true }).fill('browser-user')
  await dialog.getByLabel('初始密码（至少 10 位）', { exact: true }).fill('user-test-password')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText('browser-user', { exact: true }).first().waitFor()
  console.log('CREATE USER passed')
  await page.goto(origin + '/manage/models')
  await page.getByRole('tab', { name: /中转站/ }).click()
  await page.getByRole('button', { name: '添加中转站' }).click()
  await dialog.getByLabel('来源名称', { exact: true }).fill('Test relay')
  await dialog.getByLabel('服务基础地址', { exact: true }).fill('https://example.invalid/v1')
  await dialog.getByLabel('API Key', { exact: true }).fill('fixture-only-private-key')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Test relay', exact: true }).waitFor()
  assert(
    !(await page
      .locator('body')
      .innerText()
      .then((text) => text.includes('fixture-only-private-key')))
  )
  console.log('CREATE SOURCE passed')
  await page.locator('.source-heading .el-switch').first().click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await page.waitForTimeout(300)
  assert.equal(db.read().settings.modelSources[0].active, false)
  console.log('SOURCE SWITCH passed')
  await page.goto(origin + '/manage/settings')
  await page.getByRole('button', { name: '修改设置', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  console.log('EDIT SETTINGS passed')
  await page.goto(origin + '/manage/skills')
  await page.getByRole('button', { name: '发布 Skill', exact: true }).click()
  await dialog.getByLabel('名称（小写字母、数字、短横线）', { exact: true }).fill('test-guide')
  await dialog.getByLabel('用途描述', { exact: true }).fill('Browser acceptance')
  await dialog.getByLabel('Skill 内容', { exact: true }).fill('# Test guide\nRead references.')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page
    .getByRole('row')
    .filter({ hasText: 'test-guide' })
    .getByRole('button', { name: '编辑', exact: true })
    .click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  console.log('CREATE AND EDIT SKILL passed')
  await fs.mkdir(path.resolve('.visual-tests'), { recursive: true })
  await page.screenshot({ path: path.resolve('.visual-tests/admin-models.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ['models', 'users', 'usage']) {
    await page.goto(origin + '/manage/' + route)
    await page.waitForTimeout(300)
    const size = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    assert(size.scroll <= size.width + 2, route + ' overflows ' + JSON.stringify(size))
  }
  await page.goto(origin + '/manage/users')
  await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
  await page.getByRole('dialog').getByRole('menuitem', { name: '模型与服务', exact: true }).click()
  await page.getByRole('heading', { name: '模型与服务', exact: true }).waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  console.log('MOBILE MENU passed')
  await page.goto(origin + '/')
  await page.screenshot({ path: path.resolve('.visual-tests/download-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('ADMIN UI ACCEPTANCE passed')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  db.close()
}
