import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { backupDatabase, restoreDatabase } from "../src/maintenance.js";
async function fixture(t, db = createDatabase()) {
  const server = http.createServer(
    createApp(
      {
        encryptionSecret: "c".repeat(64),
        adminUsername: "admin",
        adminPassword: "password-123",
        demoEnabled: true,
        demoUsername: "demo",
        demoPassword: "demo-password",
      },
      db,
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const call = async (route, body = {}, token) => {
    const r = await fetch(origin + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const admin = (
    await call("/auth/login", { username: "admin", password: "password-123" })
  ).body.token;
  const users = [];
  for (const username of ["employee", "other"]) {
    const created = await call(
      "/admin/users/create",
      { username, password: "password-123" },
      admin,
    );
    users.push({
      id: created.body.id,
      token: (await call("/auth/login", { username, password: "password-123" }))
        .body.token,
    });
  }
  return { db, call, origin, admin, user: users[0], other: users[1] };
}
const plan = (overrides = {}) => ({
  name: "Pro",
  price: 19.99,
  durationDays: 30,
  level: 0,
  modelIds: [],
  creditAmount: 5,
  description: "演示套餐",
  active: true,
  ...overrides,
});
test("plan application is private and idempotent; approval freezes agreed terms and needs confirmation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/client/billing/detail")).status, 401);
  const before = (await f.call("/client/billing/detail", {}, f.user.token))
    .body;
  assert.equal(before.status, "none");
  assert.equal(before.plans.length, 0);
  const created = await f.call("/admin/plans/create", plan(), f.admin);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.price_cents, 1999);
  assert.equal(
    (await f.call("/admin/plans/create", plan({ name: "pro" }), f.admin))
      .status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/create",
        plan({ name: "bad", price: 0.001 }),
        f.admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/create",
        plan({ name: "bad", modelIds: ["unknown"] }),
        f.admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.call("/admin/plans/list", {}, f.user.token)).status,
    403,
  );
  const applied = await f.call(
    "/client/billing/apply",
    { planId: id, phone: "13800000000" },
    f.user.token,
  );
  assert.equal(applied.status, 201);
  const order = applied.body;
  assert.equal(order.status, "pending");
  assert.equal(
    (
      await f.call(
        "/client/billing/apply",
        { planId: id, phone: "13800000000" },
        f.user.token,
      )
    ).body.id,
    order.id,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.other.token)).body.orders
      .length,
    0,
  );
  assert.equal(
    (await f.call("/admin/plans/orders/" + order.id + "/approve", {}, f.admin))
      .status,
    400,
  );
  await f.call(
    "/admin/plans/" + id + "/update",
    plan({ price: 39.99, creditAmount: 50 }),
    f.admin,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.status,
    "none",
  );
  const approved = await f.call(
    "/admin/plans/orders/" + order.id + "/approve",
    { confirmed: true },
    f.admin,
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.terms.price_cents, 1999);
  assert.equal(approved.body.terms.credit_limit_micros, 5000000);
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + order.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).body.id,
    approved.body.id,
  );
  assert.equal(f.db.read().subscriptions.length, 1);
  const account = (await f.call("/client/billing/detail", {}, f.user.token))
    .body;
  assert.equal(account.status, "active");
  assert.equal(account.orders[0].status, "approved");
  assert.equal(account.subscription.terms.name, "Pro");
  assert.equal(
    (await f.call("/admin/plans/" + id + "/delete", {}, f.admin)).status,
    409,
  );
  await f.call(
    "/admin/plans/" + id + "/update",
    plan({ active: false }),
    f.admin,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.plans
      .length,
    0,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.status,
    "active",
  );
  const demo = (
    await f.call("/auth/login", { username: "demo", password: "demo-password" })
  ).body.token;
  assert.equal(
    (await f.call("/admin/plans/orders/list", {}, demo)).status,
    403,
  );
  assert.equal(
    (await f.call("/admin/plans/members/list", {}, demo)).status,
    403,
  );
});
test("plan deletion preserves approved orders and expired subscriptions", async (t) => {
  const f = await fixture(t);
  const { body: p } = await f.call("/admin/plans/create", plan(), f.admin);
  const { body: order } = await f.call(
    "/client/billing/apply", { planId: p.id, phone: "13800000000" }, f.user.token,
  );
  const remove = () => f.call("/admin/plans/" + p.id + "/delete", {}, f.admin);
  assert.equal((await remove()).body.error.code, "PLAN_IN_USE");
  await f.call("/admin/plans/" + p.id + "/update", plan({ name: "Renamed" }), f.admin);
  const approval = await f.call("/admin/plans/orders/" + order.id + "/approve", { confirmed: true }, f.admin);
  assert.equal(approval.status, 200);
  assert.equal((await remove()).body.error.code, "PLAN_IN_USE");
  f.db.transaction(state => {
    state.subscriptions.at(-1).expires_at = "2000-01-01";
  });
  assert.equal((await remove()).status, 200);
  const detail = await f.call("/client/billing/detail", {}, f.user.token);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.status, "expired");
  assert.equal(detail.body.subscription.terms.name, "Pro");
  assert.equal(detail.body.orders[0].status, "approved");
  assert.deepEqual(detail.body.orders[0].terms, order.terms);
});

test("pending orders can be cancelled only by their owner and rejected with an explanation", async (t) => {
  const f = await fixture(t),
    p = (await f.call("/admin/plans/create", plan(), f.admin)).body;
  let o = (
    await f.call(
      "/client/billing/apply",
      { planId: p.id, phone: "13800000000" },
      f.user.token,
    )
  ).body;
  assert.equal(
    (await f.call("/client/billing/" + o.id + "/cancel", {}, f.other.token))
      .status,
    404,
  );
  assert.equal(
    (await f.call("/client/billing/" + o.id + "/cancel", {}, f.user.token))
      .status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + o.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).status,
    409,
  );
  o = (
    await f.call(
      "/client/billing/apply",
      { planId: p.id, phone: "13800000000" },
      f.user.token,
    )
  ).body;
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + o.id + "/reject",
        { reply: "" },
        f.admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + o.id + "/reject",
        { reply: "请联系管理员核对收款" },
        f.admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.orders[0]
      .reply,
    "请联系管理员核对收款",
  );
});
test("manual grants and agreed plan terms persist in SQLite across reopen", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-plans-")),
    file = path.join(root, "plans.sqlite"),
    db = createDatabase(file);
  const f = await fixture(t, db),
    p = (await f.call("/admin/plans/create", plan({ price: 0 }), f.admin)).body;
  assert.equal(
    (
      await f.call(
        "/admin/plans/grants/create",
        { userId: f.user.id, planId: p.id },
        f.admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/grants/create",
        { userId: f.user.id, planId: p.id, confirmed: true },
        f.admin,
      )
    ).status,
    201,
  );
  db.close();
  const reopened = createDatabase(file);
  assert.equal(reopened.read().subscriptions[0].terms.price_cents, 0);
  assert.equal(reopened.read().subscriptions[0].terms.duration_days, 30);
  reopened.close();
  const backup = path.join(root, "plans-backup.json"),
    target = path.join(root, "restored.sqlite");
  backupDatabase(file, backup, "c".repeat(64));
  restoreDatabase(backup, target, "c".repeat(64));
  const restored = createDatabase(target);
  assert.equal(restored.read().subscriptions[0].terms.name, "Pro");
  assert.equal(restored.read().plans[0].price_cents, 0);
  restored.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("purchased models, quota cycles and expiry are enforced server-side without changing legacy users", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const upstream = http.createServer((_req, res) => {
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "test" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  f.db.transaction((state) => {
    for (const id of ["allowed", "excluded"])
      state.models.push({
        id,
        name: id,
        public_name: id,
        upstream_model: id,
        provider: "ollama",
        base_url: "http://127.0.0.1:" + upstream.address().port + "/v1",
        max_output_tokens: 128,
        context_window: 131072,
        pricing_known: true, currency: 'CNY', input_price: 1, cached_input_price: 0.1, output_price: 2,
        active: true,
      });
  });
  const clientConfig = (token) => f.call("/client/config", {}, token);
  assert.equal((await clientConfig(f.user.token)).body.models.length, 2);
  const p = (
    await f.call(
      "/admin/plans/create",
      plan({
        modelIds: ["allowed"],
        creditAmount: 5,
      }),
      f.admin,
    )
  ).body;
  await f.call(
    "/admin/plans/grants/create",
    { userId: f.user.id, planId: p.id, confirmed: true },
    f.admin,
  );
  assert.deepEqual(
    (await clientConfig(f.user.token)).body.models.map((m) => m.id),
    ["allowed"],
  );
  assert.equal((await clientConfig(f.other.token)).body.models.length, 2);
  const modelList = await fetch(f.origin + "/v1/models", {
    headers: { Authorization: "Bearer " + f.user.token },
  });
  assert.deepEqual(
    (await modelList.json()).data.map((m) => m.id),
    ["allowed"],
  );
  const request = (model) => ({
    model,
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 16,
  });
  assert.equal(
    (await f.call("/v1/chat/completions", request("excluded"), f.user.token))
      .body.error.code,
    "PLAN_MODEL_NOT_ALLOWED",
  );
  assert.equal(calls, 0);
  assert.equal(
    (await f.call("/v1/chat/completions", request("allowed"), f.user.token))
      .status,
    200,
  );
  assert.equal(calls, 1);
  f.db.transaction(state => { state.subscriptions.at(-1).terms.credit_limit_micros = 16; });
  assert.equal(
    (await f.call("/v1/chat/completions", request("allowed"), f.user.token))
      .body.error.code,
    "CREDIT_EXHAUSTED",
  );
  assert.equal(calls, 1);
  const used = (await f.call("/client/billing/detail", {}, f.user.token)).body;
  assert.equal(used.usage.used, 16);
  assert.equal(used.usage.remaining, 0);
  await f.call(
    "/admin/plans/grants/create",
    { userId: f.user.id, planId: p.id, confirmed: true },
    f.admin,
  );
  const renewed = (await f.call("/client/billing/detail", {}, f.user.token))
    .body;
  assert.equal(renewed.usage.used, 0);
  assert.equal(renewed.usage.remaining, 5000000);
  assert.equal(f.db.read().requests.length, 1);
  f.db.transaction((state) => {
    state.subscriptions.at(-1).expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
  });
  assert.equal(
    (await f.call("/v1/chat/completions", request("allowed"), f.user.token))
      .body.error.code,
    "SUBSCRIPTION_EXPIRED",
  );
  assert.equal(
    (await f.call("/v1/images/generations", { prompt: "a cat" }, f.user.token))
      .body.error.code,
    "SUBSCRIPTION_EXPIRED",
  );
  assert.equal(calls, 1);
  assert.equal((await clientConfig(f.user.token)).body.models.length, 0);
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.status,
    "expired",
  );
  assert.equal((await clientConfig(f.other.token)).body.models.length, 2);
});

test("account requests run sequentially without a configurable concurrency limit", async (t) => {
  const f = await fixture(t);
  let active = 0,
    maximum = 0;
  const upstream = http.createServer((_req, res) => {
    active++;
    maximum = Math.max(maximum, active);
    setTimeout(() => {
      active--;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "test" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }),
      );
    }, 50);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  f.db.transaction((state) => {
    state.models.push({
      id: "local",
      name: "local",
      public_name: "local",
      upstream_model: "local",
      provider: "ollama",
      base_url: "http://127.0.0.1:" + upstream.address().port + "/v1",
      max_output_tokens: 128,
      pricing_known: true, currency: 'CNY', input_price: 0, cached_input_price: 0, output_price: 0,
      active: true,
    });
  });
  const p = (
    await f.call(
      "/admin/plans/create",
      plan({ modelIds: ["local"] }),
      f.admin,
    )
  ).body;
  await f.call(
    "/admin/plans/grants/create",
    { userId: f.user.id, planId: p.id, confirmed: true },
    f.admin,
  );
  const body = {
    model: "local",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 16,
  };
  const responses = await Promise.all([
    f.call("/v1/chat/completions", body, f.user.token),
    f.call("/v1/chat/completions", body, f.user.token),
  ]);
  assert(responses.every((r) => r.status === 200));
  assert.equal(maximum, 1);
});

test("manual payment is private, never grants by client claims, and rejects reused transactions", async (t) => {
  const f = await fixture(t);
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const settings = {
    enabled: true,
    recipient: "测试收款方",
    instructions: "请备注订单号",
    image,
  };
  assert.equal(
    (await f.call("/admin/plans/payment-config/detail", {}, f.user.token))
      .status,
    403,
  );
  const demo = (
    await f.call("/auth/login", { username: "demo", password: "demo-password" })
  ).body.token;
  assert.equal(
    (await f.call("/admin/plans/payment-config/detail", {}, demo)).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/payment-config/update",
        { ...settings, image: "data:image/svg+xml;base64,PHN2Zy8+" },
        f.admin,
      )
    ).status,
    400,
  );
  const configured = await f.call(
    "/admin/plans/payment-config/update",
    settings,
    f.admin,
  );
  assert.equal(configured.status, 200);
  assert(!JSON.stringify(configured.body).includes("base64"));
  assert.equal((await fetch(f.origin + configured.body.qrUrl)).status, 200);
  assert.equal(
    (
      await fetch(
        f.origin +
          configured.body.qrUrl.replace(
            /signature=[^&]+/,
            "signature=" + "0".repeat(64),
          ),
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.payment,
    null,
  );
  assert(
    !JSON.stringify(
      (await f.call("/admin/settings/detail", {}, demo)).body,
    ).includes("data:image"),
  );
  const p = (await f.call("/admin/plans/create", plan(), f.admin)).body;
  const order = (
    await f.call(
      "/client/billing/apply",
      { planId: p.id, phone: "13800000000", paid: true },
      f.user.token,
    )
  ).body;
  const detail = (await f.call("/client/billing/detail", {}, f.user.token))
    .body;
  assert.equal(detail.status, "none");
  assert.equal(detail.orders[0].status, "pending");
  assert(detail.payment.qrUrl.startsWith("/downloads/billing-payment/"));
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.other.token)).body.payment,
    null,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + order.id + "/approve",
        { confirmed: true, transactionId: "265" },
        f.admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + order.id + "/approve",
        { confirmed: true, transactionId: 123 },
        f.admin,
      )
    ).status,
    400,
  );
  const approved = await f.call(
    "/admin/plans/orders/" + order.id + "/approve",
    { confirmed: true, transactionId: "2026103100000001" },
    f.admin,
  );
  assert.equal(approved.status, 200);
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + order.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).status,
    200,
  );
  assert.equal(f.db.read().subscriptions.length, 1);
  const other = (
    await f.call(
      "/client/billing/apply",
      { planId: p.id, phone: "13800000000" },
      f.other.token,
    )
  ).body;
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + other.id + "/approve",
        { confirmed: true, transactionId: "2026103100000001" },
        f.admin,
      )
    ).status,
    409,
  );
  assert.equal(f.db.read().subscriptions.length, 1);
  const changed = await f.call(
    "/admin/plans/payment-config/update",
    { ...settings, recipient: "新的测试收款方" },
    f.admin,
  );
  assert.equal(changed.status, 200);
  assert.equal((await fetch(f.origin + detail.payment.qrUrl)).status, 410);
  const free = (
    await f.call(
      "/admin/plans/create",
      plan({ name: "Free", price: 0, level: 1 }),
      f.admin,
    )
  ).body;
  const freeOrder = (
    await f.call(
      "/client/billing/apply",
      { planId: free.id, phone: "13800000000" },
      f.user.token,
    )
  ).body;
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.payment,
    null,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + freeOrder.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).status,
    200,
  );
});

test("manual payment configuration survives SQLite reopen without being added to public settings", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-payment-")),
    file = path.join(root, "payment.sqlite");
  let db = createDatabase(file);
  const f = await fixture(t, db);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(
    (
      await f.call(
        "/admin/plans/payment-config/update",
        { enabled: false, recipient: "测试收款方", instructions: "稍后启用" },
        f.admin,
      )
    ).status,
    200,
  );
  db.close();
  db = createDatabase(file);
  assert.equal(db.read().paymentSettings[0].recipient, "测试收款方");
  assert.equal(db.read().settings.paymentSettings, undefined);
});

test("default plans apply only to new users; upgrades and ended-order deletion are guarded", async (t) => {
  const f = await fixture(t);
  const create = async (fields) =>
    await f.call("/admin/plans/create", plan(fields), f.admin);
  assert.equal(
    (await create({ name: "Bad default", isDefault: true })).status,
    400,
  );
  const basic = (
    await create({ name: "Basic", price: 0, level: 0, isDefault: true })
  ).body;
  const plus = (await create({ name: "Plus", level: 1 })).body;
  const pro = (await create({ name: "Pro+", level: 2 })).body;
  const fresh = (
    await f.call(
      "/admin/users/create",
      { username: "fresh", password: "password-123" },
      f.admin,
    )
  ).body;
  assert.equal(
    f.db.read().subscriptions.find((x) => x.user_id === fresh.id).plan_id,
    basic.id,
  );
  assert.equal(
    f.db.read().subscriptions.some((x) => x.user_id === f.user.id),
    false,
  );
  const token = (
    await f.call("/auth/login", { username: "fresh", password: "password-123" })
  ).body.token;
  const apply = async (id) =>
    f.call(
      "/client/billing/apply",
      { planId: id, phone: "13800000000" },
      token,
    );
  assert.equal((await apply(basic.id)).status, 409);
  const lower = (await apply(plus.id)).body,
    higher = (await apply(pro.id)).body;
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + higher.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + lower.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call("/admin/plans/orders/" + higher.id + "/delete", {}, f.admin))
      .status,
    409,
  );
  assert.equal(
    (await f.call("/admin/plans/orders/" + lower.id + "/delete", {}, f.admin))
      .status,
    409,
  );
  assert.equal(
    (await f.call("/client/billing/" + lower.id + "/cancel", {}, token)).status,
    200,
  );
  assert.equal(
    (await f.call("/admin/plans/orders/" + lower.id + "/delete", {}, token))
      .status,
    403,
  );
  assert.equal(
    (await f.call("/admin/plans/orders/" + lower.id + "/delete", {}, f.admin))
      .status,
    200,
  );
  assert.equal(
    f.db.read().planOrders.some((x) => x.id === lower.id),
    false,
  );
  const next = (
    await create({ name: "New default", price: 0, isDefault: true })
  ).body;
  assert.equal(f.db.read().plans.filter((x) => x.is_default).length, 1);
  assert.equal(
    f.db.read().plans.find((x) => x.id === basic.id).is_default,
    false,
  );
  assert.equal(
    f.db.read().plans.find((x) => x.id === next.id).is_default,
    true,
  );
  assert.equal(
    f.db.read().subscriptions.findLast((x) => x.user_id === fresh.id).plan_id,
    pro.id,
  );
});

test("free plans activate immediately, cannot be replayed to refill quota, and Plus can only upgrade to Pro", async (t) => {
  const f = await fixture(t);
  const create = async (fields) =>
    (await f.call("/admin/plans/create", plan(fields), f.admin)).body;
  const basic = await create({ name: "Basic", price: 0, level: 0 });
  const plus = await create({ name: "Plus", level: 1 });
  const pro = await create({ name: "Premium", level: 2 });
  const invalid = plan({ name: "Missing level" });
  delete invalid.level;
  assert.equal(
    (await f.call("/admin/plans/create", invalid, f.admin)).status,
    400,
  );
  const free = await f.call(
    "/client/billing/apply",
    { planId: basic.id },
    f.user.token,
  );
  assert.equal(free.status, 201);
  assert.equal(free.body.status, "approved");
  assert.equal(f.db.read().subscriptions.length, 1);
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.status,
    "active",
  );
  assert.equal(
    (await f.call("/client/billing/apply", { planId: basic.id }, f.user.token))
      .status,
    409,
  );
  assert.equal(f.db.read().subscriptions.length, 1);
  await f.call(
    "/admin/plans/grants/create",
    { userId: f.user.id, planId: plus.id, confirmed: true },
    f.admin,
  );
  assert.equal(
    (await f.call("/client/billing/apply", { planId: basic.id }, f.user.token))
      .status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/client/billing/apply",
        { planId: plus.id, phone: "13800000000" },
        f.user.token,
      )
    ).status,
    201,
  );
  const upgrade = await f.call(
    "/client/billing/apply",
    { planId: pro.id, phone: "13800000000" },
    f.user.token,
  );
  assert.equal(upgrade.status, 201);
  assert.equal(upgrade.body.status, "pending");
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.subscription
      .terms.id,
    plus.id,
    "paid plans still require confirmation",
  );
  // Editing the upgrade hierarchy applies to current users without rewriting their purchased quota terms.
  await f.call(
    "/admin/plans/" + plus.id + "/update",
    plan({ name: "Plus", level: 3 }),
    f.admin,
  );
  assert.equal(
    (await f.call("/client/billing/detail", {}, f.user.token)).body.subscription
      .terms.level,
    3,
  );
  assert.equal(
    (
      await f.call(
        "/admin/plans/orders/" + upgrade.body.id + "/approve",
        { confirmed: true },
        f.admin,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/client/billing/apply",
        { planId: pro.id, phone: "13800000000" },
        f.user.token,
      )
    ).status,
    409,
  );
});

test("manual approvals allow omitted, empty and whitespace-only payment references", async (t) => {
  for (const reference of [undefined, "", "   "]) {
    const f = await fixture(t);
    const p = (await f.call("/admin/plans/create", plan(), f.admin)).body;
    f.db.transaction(state => { state.paymentSettings = [{enabled:true}]; });
    const order = (await f.call("/client/billing/apply", {planId:p.id, phone:"13800000000"}, f.user.token)).body;
    const route = "/admin/plans/orders/" + order.id + "/approve";
    assert.equal((await f.call(route, {}, f.admin)).status, 400);
    const result = await f.call(route, {confirmed:true, ...(reference === undefined ? {} : {transactionId:reference})}, f.admin);
    assert.equal(result.status, 200);
    assert.equal(f.db.read().planOrders.find(item => item.id === order.id).verified_transaction_id, null);
    assert.equal(f.db.read().subscriptions.length, 1);
  }
});

test('administrators reset only the current active cycle without changing expiry or request history', async t => {
  const f = await fixture(t);
  const p = (await f.call('/admin/plans/create', plan(), f.admin)).body;
  const member = (await f.call('/admin/plans/grants/create', {userId:f.user.id,planId:p.id,confirmed:true}, f.admin)).body;
  f.db.transaction(state => {state.subscriptions.at(-1).spent_micros=123000;state.requests.push({id:'previous',subscription_id:member.id,status:'success',cost_micros:123000});});
  const route='/admin/plans/members/'+member.id+'/reset';
  assert.equal((await f.call(route,{confirmed:true},f.user.token)).status,403);
  assert.equal((await f.call(route,{},f.admin)).status,400);
  f.db.transaction(state => {state.requests[0].status='pending';});
  assert.equal((await f.call(route,{confirmed:true},f.admin)).body.error.code,'REQUEST_IN_PROGRESS');
  f.db.transaction(state => {state.requests[0].status='success';});
  assert.equal((await f.call(route,{confirmed:true},f.admin)).status,200);
  const saved=f.db.read().subscriptions.at(-1);
  assert.equal(saved.spent_micros,0);assert.equal(saved.expires_at,member.expires_at);assert.equal(saved.started_at,member.started_at);
  assert.equal(f.db.read().requests[0].cost_micros,123000);
  const users=(await f.call('/admin/users/list',{},f.admin)).body;
  assert.deepEqual(users.find(user=>user.id===f.user.id).credit_usage,{used:0,limit:5000000});
  f.db.transaction(state => {delete state.subscriptions.at(-1).terms.credit_limit_micros;});
  assert.equal((await f.call(route,{confirmed:true},f.admin)).body.error.code,'BILLING_SETUP_REQUIRED');
  assert.equal((await f.call('/admin/users/list',{},f.admin)).status,200);
  await f.call('/admin/plans/grants/create',{userId:f.user.id,planId:p.id,confirmed:true},f.admin);
  assert.equal((await f.call(route,{confirmed:true},f.admin)).body.error.code,'SUBSCRIPTION_CHANGED');
  f.db.transaction(state => {state.subscriptions.at(-1).expires_at='2000-01-01';});
  assert.equal((await f.call('/admin/plans/members/'+f.db.read().subscriptions.at(-1).id+'/reset',{confirmed:true},f.admin)).body.error.code,'SUBSCRIPTION_EXPIRED');
});

test('plan credit limits distinguish zero from the five-yuan default and reject invalid amounts',async t=>{
 const f=await fixture(t);
 for(const creditAmount of [-1,0.0000001,'0',null])assert.equal((await f.call('/admin/plans/create',plan({creditAmount}),f.admin)).status,400);
 const zero=(await f.call('/admin/plans/create',plan({name:'Zero',creditAmount:0}),f.admin)).body;
 assert.equal(zero.credit_limit_micros,0);assert(!Object.hasOwn(zero,'token_limit'));assert(!Object.hasOwn(zero,'max_concurrent_requests'));
 await f.call('/admin/plans/grants/create',{userId:f.user.id,planId:zero.id,confirmed:true},f.admin);
 const limited=(await f.call('/client/billing/detail',{},f.user.token)).body;
 assert.equal(limited.usage.remaining,0);
 const standard=(await f.call('/admin/plans/create',plan({name:'Default',creditAmount:undefined}),f.admin)).body;
 await f.call('/admin/plans/grants/create',{userId:f.user.id,planId:standard.id,confirmed:true},f.admin);
 const detail=(await f.call('/client/billing/detail',{},f.user.token)).body;
 assert.equal(detail.usage.remaining,5000000);assert.equal(detail.subscription.terms.credit_limit_micros,5000000);
});
