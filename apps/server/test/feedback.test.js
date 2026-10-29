import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { backupDatabase, restoreDatabase } from "../src/maintenance.js";
const secret = "b".repeat(64),
  png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=";
async function fixture(t, db = createDatabase()) {
  const server = http.createServer(
    createApp(
      {
        encryptionSecret: secret,
        adminUsername: "admin",
        adminPassword: "password-123",
        demoEnabled: true, demoUsername: "demo", demoPassword: "demo-password",
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
  async function call(route, body = {}, token) {
    const r = await fetch(origin + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  const admin = (
    await call("/auth/login", { username: "admin", password: "password-123" })
  ).body.token;
  const users = [];
  for (const username of ["employee", "other"]) {
    await call(
      "/admin/users/create",
      { username, password: "password-123" },
      admin,
    );
    users.push(
      (await call("/auth/login", { username, password: "password-123" })).body
        .token,
    );
  }
  return { db, origin, call, admin, user: users[0], other: users[1] };
}
const submission = (changes = {}) => ({
  submissionId: randomUUID(),
  phone: "13800000000",
  content: "问题描述",
  images: [{ name: "截图.png", dataUrl: png }],
  ...changes,
});
test("feedback is private, previews use expiring links, and processing reaches employee", async (t) => {
  const f = await fixture(t),
    body = submission();
  assert.equal((await f.call("/client/feedback/list")).status, 401);
  const created = await f.call("/client/feedback/create", body, f.user);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(
    (await f.call("/client/feedback/create", body, f.user)).body.id,
    id,
  );
  assert.equal(
    (await f.call("/client/feedback/list", {}, f.other)).body.feedback.length,
    0,
  );
  assert.equal((await f.call("/admin/feedback/list", {}, f.user)).status, 403);
  const demo = (await f.call("/auth/login", {username:"demo",password:"demo-password"})).body.token;
  assert.equal((await f.call("/admin/feedback/list", {}, demo)).status,403);
  const list = await f.call("/admin/feedback/list", {}, f.admin);
  assert.equal(list.body[0].phone, body.phone);
  assert(!JSON.stringify(list.body).includes("base64"));
  const detail = (
    await f.call("/admin/feedback/" + id + "/detail", {}, f.admin)
  ).body;
  assert(!JSON.stringify(detail).includes("base64"));
  const image = await fetch(f.origin + detail.images[0].url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert((await image.arrayBuffer()).byteLength > 0);
  const expired = detail.images[0].url.replace(/expires=\d+/, "expires=1");
  assert.equal((await fetch(f.origin + expired)).status, 403);
  assert.equal(
    (await fetch(f.origin + "/downloads/feedback/" + id + "/0")).status,
    403,
  );
  for (const status of ["accepted", "rejected", "completed"]) {
    assert.equal(
      (
        await f.call(
          "/admin/feedback/" + id + "/update",
          { status, reply: "感谢反馈" },
          f.admin,
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.call("/client/feedback/list", {}, f.user)).body.feedback[0]
        .status,
      status,
    );
  }
  assert.equal(
    (await f.call("/client/feedback/list", {}, f.user)).body.feedback[0].reply,
    "感谢反馈",
  );
  assert.equal(
    (await f.call("/admin/feedback/" + id + "/delete", {}, f.admin)).status,
    200,
  );
  assert.equal((await fetch(f.origin + detail.images[0].url)).status, 404);
  assert(f.db.read().audits.some((item) => item.action === "feedback.delete"));
});
test("feedback validates text, phone, image type and daily rate; emoji counts as one character", async (t) => {
  const f = await fixture(t);
  for (const changes of [
    { content: "" },
    { content: "字".repeat(1001) },
    { phone: "" },
    {
      images: [
        { name: "bad.svg", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
      ],
    },
    {
      images: [{ name: "bad.png", dataUrl: "data:image/png;base64,aGVsbG8=" }],
    },
    { images: Array(4).fill({ name: "a", dataUrl: png }) },
  ])
    assert.equal(
      (await f.call("/client/feedback/create", submission(changes), f.user))
        .status,
      400,
    );
  assert.equal(
    (
      await f.call(
        "/client/feedback/create",
        submission({ content: "😀".repeat(1000) }),
        f.user,
      )
    ).status,
    201,
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      (await f.call("/client/feedback/create", submission(), f.user)).status,
      201,
    );
  assert.equal(
    (await f.call("/client/feedback/create", submission(), f.user)).status,
    429,
  );
});
test("feedback and screenshots survive SQLite reopen and encrypted backup restore", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-feedback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "test.sqlite"),
    db = createDatabase(file),
    f = await fixture(t, db);
  await f.call("/client/feedback/create", submission(), f.user);
  db.close();
  const reopened = createDatabase(file);
  assert.equal(reopened.read().feedback.length, 1);
  reopened.close();
  const backup = path.join(root, "backup.json"),
    restored = path.join(root, "restored.sqlite");
  backupDatabase(file, backup, secret);
  restoreDatabase(backup, restored, secret);
  const restoredDb = createDatabase(restored);
  assert.equal(restoredDb.read().feedback[0].images[0].dataUrl, png);
  restoredDb.close();
});
