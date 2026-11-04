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
    demoEnabled: true,
    adminPassword: 'browser-test-password',
    timeoutMs: 5000,
  },
  db
)
const server = http.createServer(app)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = 'http://127.0.0.1:' + server.address().port
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
  assert.equal(await page.getByRole('heading', { name: '员工安装即用，团队统一管理' }).count(), 0)
  await page.getByRole('menuitem', { name: '用户管理', exact: true }).click()
  await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor()
  await page.goto(origin + '/missing-page-test')
  await page.getByText('抱歉，您访问的页面不存在', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await page.getByRole('heading', { name: '员工安装即用，团队统一管理', exact: true }).waitFor()
  assert.equal(await page.getByRole('menuitem', {name:'部门管理',exact:true}).count(),0)
  console.log('NAVIGATION, HOMEPAGE AND 404 passed')
  async function checkPageBounds(route) {
    await page.waitForFunction(() => !document.querySelector('.el-loading-mask'))
    await page.locator('#admin-content').evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const bounds = await page.evaluate(() => {
      const main = document.querySelector('#admin-content'), panel = document.querySelector('.page-panel'), content = panel.querySelector('.page-content')
      const visible = [...content.children, ...content.querySelectorAll('.pagination-wrapper')].filter(el => {
        const style = getComputedStyle(el)
        return el.getBoundingClientRect().height > 0 && !['fixed', 'absolute'].includes(style.position)
      })
      const bottom = Math.max(...visible.map(el => el.getBoundingClientRect().bottom))
      return { contained: bottom <= panel.getBoundingClientRect().bottom + 1,
        bottomGap: main.getBoundingClientRect().bottom - bottom,
        padding: parseFloat(getComputedStyle(main).paddingBottom), overflow: main.scrollWidth - main.clientWidth }
    })
    assert(bounds.contained, route + ' content escapes its background')
    assert(bounds.bottomGap >= bounds.padding - 1, route + ' bottom padding is clipped')
    assert(bounds.overflow <= 1, route + ' overflows horizontally')
  }
  const pages = {
    users: '用户管理',
    models: '模型与服务',
    keys: 'Key 管理',
    skills: '共享 Skill',
    knowledge: '团队知识库',
    overview: '工作台概览',
    usage: '用量统计',
    plans: '套餐管理',
    feedback: '问题反馈',
    requests: '系统记录',
    settings: '系统设置',
    system: '系统状态',
  }
  for (const [route, title] of Object.entries(pages)) {
    await page.goto(origin + '/manage/' + route)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    await page.waitForTimeout(100)
    await checkPageBounds(route)
    if (route === 'system') {
      await page.locator('.el-collapse-item__header').click()
      await page.waitForTimeout(350)
      await checkPageBounds(route + ' expanded')
    }
    console.log('PAGE', route, 'passed')
  }
  await page.goto(origin + '/manage/users')
  await page.getByRole('button', { name: '创建用户', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('账号', { exact: true }).fill('browser-user')
  await dialog.getByLabel('初始密码（10～256 位）', { exact: true }).fill('user-test-password')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText('browser-user', { exact: true }).first().waitFor()
  console.log('CREATE USER passed')
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qcode.admin.session')))
  await page.request.post(origin + '/admin/keys/create', {headers:{Authorization:'Bearer ' + session.token},data:{name:'Smoke Key',apiKey:'fixture-only-private-key'}})
  await page.goto(origin + '/manage/models')
  await page.getByRole('tab', { name: /中转站/ }).click()
  await page.getByRole('button', { name: '添加中转站' }).click()
  await dialog.getByLabel('来源名称', { exact: true }).fill('Test relay')
  await dialog.getByLabel('服务基础地址', { exact: true }).fill('https://example.invalid/v1')
  await dialog.locator('.el-form-item').filter({hasText:'站点 Key 池（按选择顺序使用）'}).locator('.el-select').click()
  await page.getByRole('option', {name:/Smoke Key/}).click()
  await page.keyboard.press('Escape')
  await dialog.locator('.el-form-item').filter({hasText:'启动时自动刷新模型列表'}).locator('.el-select').click()
  await page.getByRole('option', {name:'关闭',exact:true}).click()
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
  for (const route of Object.keys(pages)) {
    await page.goto(origin + '/manage/' + route)
    await page.waitForTimeout(300)
    const size = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    assert(size.scroll <= size.width + 2, route + ' overflows ' + JSON.stringify(size))
    await checkPageBounds(route)
    if (route === 'system') {
      await page.locator('.el-collapse-item__header').click()
      await page.waitForTimeout(350)
      await checkPageBounds(route + ' expanded')
    }
  }
  await page.goto(origin + '/manage/users')
  await page.getByRole('button', { name: '打开导航菜单', exact: true }).click()
  await page.getByRole('dialog').getByRole('menuitem', { name: '模型与服务', exact: true }).click()
  await page.getByRole('heading', { name: '模型与服务', exact: true }).waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  console.log('MOBILE MENU passed')
  await page.goto(origin + '/')
  await page.screenshot({ path: path.resolve('.visual-tests/download-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.goto(origin + '/login')
  await page.getByRole('button', { name: '体验演示版', exact: true }).click()
  assert.equal(await page.getByLabel('账号', { exact: true }).inputValue(), 'demo')
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), 'qcode-demo-2026')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByText('演示模式', { exact: true }).waitFor()
  await page.goto(origin + '/manage/users')
  await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor()
  console.log('DEMO LOGIN AND READ-ONLY NAVIGATION passed')
  assert.deepEqual(errors, [])
  console.log('ADMIN UI ACCEPTANCE passed')
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  db.close()
}
