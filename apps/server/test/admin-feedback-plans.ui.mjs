import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
const require = createRequire(import.meta.url),
  adminRequire = createRequire(
    new URL("../../admin/package.json", import.meta.url),
  );
const { chromium } = require(process.env.QCODE_TEST_PLAYWRIGHT_MODULE),
  { createServer } = await import(pathToFileURL(adminRequire.resolve("vite")));
const db = createDatabase(),
  api = http.createServer(
    createApp(
      {
        encryptionSecret: "d".repeat(64),
        adminUsername: "admin",
        adminPassword: "test-password",
      },
      db,
    ),
  );
api.listen(0, "127.0.0.1");
await once(api, "listening");
const origin = "http://127.0.0.1:" + api.address().port;
const call = async (route, body = {}, token) => {
  const r = await fetch(origin + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
  return await r.json();
};
const session = await call("/auth/login", {
  username: "admin",
  password: "test-password",
});
await call(
  "/admin/users/create",
  { username: "employee", password: "test-password" },
  session.token,
);
const employee = await call("/auth/login", {
  username: "employee",
  password: "test-password",
});
db.transaction((s) => {
  for (const [id, name] of [["m1", "测试模型 A"], ["m2", "测试模型 B"]]) s.models.push({
    id,
    name,
    public_name: id,
    upstream_model: id,
    provider: "ollama",
    base_url: "http://127.0.0.1:1/v1",
    active: true,
  });
});
const server = await createServer({
  root: path.resolve("apps/admin"),
  configFile: path.resolve("apps/admin/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 0,
    proxy: Object.fromEntries(
      ["/admin", "/auth", "/downloads", "/branding"].map((prefix) => [
        prefix,
        origin,
      ]),
    ),
  },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.addInitScript(
    (value) =>
      sessionStorage.setItem("qcode.admin.session", JSON.stringify(value)),
    session,
  );
  await page.goto(
    "http://127.0.0.1:" + server.httpServer.address().port + "/manage/plans",
  );
  await page.getByRole("button", { name: "创建套餐", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建套餐" });
  await dialog
    .locator(".el-form-item")
    .filter({ hasText: "套餐名称" })
    .locator("input")
    .fill("UI 验收套餐");
  await dialog
    .locator(".el-form-item")
    .filter({ hasText: "价格（元）" })
    .locator("input")
    .fill("19.99");
  await dialog.getByRole("button", { name: "已选 0 个模型" }).click();
  const picker = page.getByRole("dialog", { name: "选择与排序模型" });
  await picker.getByRole("combobox").click();
  await page.getByRole("option", { name: "测试模型 A", exact: true }).click();
  await page.getByRole("option", { name: "测试模型 B", exact: true }).click();
  await picker.getByRole("heading", { name: "选择与排序模型" }).click();
  const orderedModels = picker.getByRole("list", { name: "套餐模型顺序" }).getByRole("listitem");
  await orderedModels.nth(1).dragTo(orderedModels.first());
  await orderedModels.first().getByText(/测试模型 B（默认）/).waitFor();
  await picker.screenshot({ path: path.resolve('apps/admin/dist/plan-order-preview.png') });
  await picker.getByRole("button", { name: "确定", exact: true }).click();
  await dialog.getByRole("button", { name: "已选 2 个模型" }).waitFor();
  await dialog.screenshot({ path: path.resolve('apps/admin/dist/plan-model-count-preview.png') });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(db.read().plans.length, 1);
  assert.equal(db.read().plans[0].price_cents, 1999);
  assert.deepEqual(db.read().plans[0].model_ids, ["m2", "m1"]);
  assert.equal(db.read().plans[0].credit_limit_micros, 5000000);
  await page.screenshot({ path: path.resolve('apps/admin/dist/credit-plans-preview.png') });
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: 100, height: 100 },
  });
  await call('/admin/plans/grants/create', {userId:employee.user.id,planId:db.read().plans[0].id,confirmed:true}, session.token);
  const clientConfig = await call("/client/config", {}, employee.token);
  assert.deepEqual(clientConfig.models.map(model => model.id), ["m2", "m1"]);
  assert.equal(clientConfig.defaultModelId, "m2");
  db.transaction(state => {state.subscriptions.at(-1).spent_micros=123000;});
  await page.getByRole('tab',{name:'已开通用户',exact:true}).click();
  await page.getByRole('button',{name:'切换套餐',exact:true}).click();
  const switching=page.getByRole('dialog');
  assert.equal(await switching.locator('.el-form-item').filter({hasText:'普通用户'}).count(),0);
  await switching.getByText('切换 employee 的套餐（重新开始有效期与额度）',{exact:true}).waitFor();
  await page.screenshot({path:path.resolve('apps/admin/dist/plan-switch-preview.png')});
  await switching.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'重置额度',exact:true}).click();
  await page.getByRole('button',{name:'确定',exact:true}).click();
  await page.getByRole('dialog',{name:'确认操作'}).waitFor({state:'hidden'});
  assert.equal(db.read().subscriptions.at(-1).spent_micros,0);
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/manage/users');
  await page.getByText('已用金额（元）',{exact:true}).waitFor();
  await page.getByText('套餐总额度（元）',{exact:true}).waitFor();
  await call(
    "/client/feedback/create",
    {
      submissionId: "ui-feedback-test",
      phone: "13800000000",
      content: "浏览器测试反馈",
      images: [
        {
          name: "screen.png",
          dataUrl: "data:image/png;base64," + png.toString("base64"),
        },
      ],
    },
    employee.token,
  );
  await page.goto(
    "http://127.0.0.1:" + server.httpServer.address().port + "/manage/feedback",
  );
  await page.getByRole("button", { name: "查看", exact: true }).click();
  const detail = page.getByRole("dialog");
  await detail.getByText("13800000000", { exact: true }).waitFor();
  await detail.locator(".el-image__inner").evaluate((img) => img.decode());
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    const box = await detail.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width + 1);
  }
  console.log(
    "PASS administrator component form, multiple model selection, persisted price, private screenshot and responsive dialog",
  );
  await page.close();
} finally {
  await browser.close();
  server.httpServer?.closeAllConnections();
  await server.close();
  api.closeAllConnections();
  await new Promise((r) => api.close(r));
  db.close();
}
