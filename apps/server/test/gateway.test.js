import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, readConfig } from '../src/app.js';
import { createDatabase, createVault, hashPassword } from '../src/database.js';
import { consumption, quotas } from '../src/domain.js';
const encryptionSecret = 'a'.repeat(64);
async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
export async function fixture(t, extra = {}) {
  let received, calls = 0;
  const upstream = await listen(t, http.createServer(async (req, res) => {
    if (req.url === '/models') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); received = { body, auth: req.headers.authorization }; calls++;
    if (body.testCase === 'timeout') return;
    if (body.testCase === 'failure') return res.writeHead(401).end('secret-provider-key internal-address');
    const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: '你好' } }] })}\r\n\r\ndata: ${JSON.stringify({ choices: [], usage })}\r\n\r\n${body.testCase === 'truncated' ? '' : 'data: [DONE]\r\n\r\n'}`);
      for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7));
      res.end();
    } else {
      if (body.testCase === 'slow') await new Promise(resolve => setTimeout(resolve, 80));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], ...(body.testCase === 'missing-usage' ? {} : { usage }) }));
    }
  }));
  const db = createDatabase();
  const config = { encryptionSecret, adminUsername: 'admin', adminPassword: 'admin-password', baseUrl: upstream,
    upstreamModel: 'private-model', publicModel: 'qcode-model', upstreamKey: 'secret-provider-key', timeoutMs: 2000, ...extra };
  const url = await listen(t, http.createServer(createApp(config, db)));
  async function request(route, method = 'GET', body, token) {
    const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const admin = (await request('/auth/login', 'POST', { username: 'admin', password: 'admin-password' })).body.token;
  const key = db.read().keys[0];
  const create = async (username = 'alice', more = {}) => {
    const result = await request('/admin/users', 'POST', { username, password: 'user-password', keyId: key.id, ...more }, admin);
    assert.equal(result.status, 201); return result.body;
  };
  const login = async (username = 'alice') => (await request('/auth/login', 'POST', { username, password: 'user-password' })).body.token;
  const chat = (token, more = {}) => request('/v1/chat/completions', 'POST', { model: 'qcode-model', messages: [{ role: 'user', content: 'hello' }], max_tokens: 10, ...more }, token);
  return { db, url, request, admin, key, create, login, chat, received: () => received, calls: () => calls };
}

test('user lifecycle, safe projections, permissions, uniqueness and revocation', async t => {
  const f = await fixture(t), user = await f.create(), token = await f.login();
  assert.equal((await f.request('/admin/users', 'GET', undefined, token)).status, 403);
  assert.equal((await f.request('/auth/login', 'POST', { username: 'alice', password: 'user-password' })).status, 409);
  const users = await f.request('/admin/users', 'GET', undefined, f.admin);
  assert.ok(users.body.find(u => u.id === user.id).last_login_at);
  assert.doesNotMatch(JSON.stringify(users.body), /secret-provider-key|password_hash|token_hash/);
  assert.equal((await f.request('/admin/users', 'POST', { username: 'ALICE', password: 'user-password' }, f.admin)).status, 409);
  assert.equal((await f.request(`/admin/users/${user.id}/status`, 'PATCH', { isActive: 'false' }, f.admin)).status, 400);
  await f.request(`/admin/users/${user.id}/status`, 'PATCH', { isActive: false }, f.admin);
  assert.equal((await f.chat(token)).status, 401);
  assert.equal((await f.request('/auth/login', 'POST', { username: 'alice', password: 'user-password' })).status, 403);
  await f.request(`/admin/users/${user.id}/status`, 'PATCH', { isActive: true }, f.admin);
  const second = await f.login();
  await f.request(`/admin/users/${user.id}/password`, 'POST', { password: 'replacement-password' }, f.admin);
  assert.equal((await f.chat(second)).status, 401);
  assert.equal((await f.request('/auth/login', 'POST', { username: 'alice', password: 'user-password' })).status, 401);
  await f.request(`/admin/users/${user.id}`, 'DELETE', undefined, f.admin);
  assert.ok((await f.create('bob')).id > user.id);
  assert.equal((await f.request('/admin/users/1', 'DELETE', undefined, f.admin)).status, 400);
});

test('refresh rotates token, expiry and logout revoke access', async t => {
  const f = await fixture(t); await f.create(); const token = await f.login();
  const refreshed = await f.request('/auth/refresh', 'POST', {}, token); assert.equal(refreshed.status, 200);
  assert.equal((await f.chat(token)).status, 401);
  await f.request('/auth/logout', 'POST', {}, refreshed.body.token);
  assert.equal((await f.chat(refreshed.body.token)).status, 401);
  const latest = await f.login(); f.db.transaction(s => { for (const token of s.tokens.filter(t => t.user_id !== 1)) token.expires_at = '2000-01-01'; });
  assert.equal((await f.chat(latest)).status, 401);
});

test('JSON and split UTF-8 streaming record usage, tools and sanitized errors', async t => {
  const f = await fixture(t); await f.create(); const token = await f.login();
  const result = await f.chat(token, { tools: [{ type: 'function', function: { name: 'read_file' } }], tool_choice: 'auto' });
  assert.equal(result.status, 200); assert.equal(result.body.model, 'qcode-model');
  assert.equal(f.received().auth, 'Bearer secret-provider-key'); assert.equal(f.received().body.model, 'private-model'); assert.equal(f.received().body.tools[0].function.name, 'read_file');
  const response = await fetch(f.url + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ model: 'qcode-model', messages: [{}], stream: true, max_tokens: 10 }) });
  assert.match(await response.text(), /你好/); assert.equal(f.received().body.stream_options.include_usage, true);
  const failed = await f.chat(token, { testCase: 'failure' }); assert.equal(failed.status, 502); assert.doesNotMatch(JSON.stringify(failed.body), /secret-provider-key|internal-address/);
  const stats = (await f.request('/admin/usage', 'GET', undefined, f.admin)).body;
  assert.equal(stats.totals.success, 2); assert.equal(stats.totals.tokens, 10); assert.equal(stats.totals.failed, 1);
  assert.equal(f.db.read().requests[0].input_tokens, 3);
});

test('quotas reserve concurrent requests, reject exhaustion and support reset', async t => {
  const f = await fixture(t), user = await f.create('alice', { quotas: { totalRequests: 1 } }), token = await f.login();
  const results = await Promise.all([f.chat(token, { testCase: 'slow' }), f.chat(token, { testCase: 'slow' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]); assert.equal(f.calls(), 1);
  assert.equal((await f.chat(token)).status, 429);
  await f.request(`/admin/users/${user.id}/reset-quota`, 'POST', {}, f.admin);
  assert.equal((await f.chat(token)).status, 200);
  await f.request(`/admin/users/${user.id}`, 'PATCH', { quotas: { totalTokens: 20 } }, f.admin);
  assert.equal((await f.chat(token)).status, 429);
});

test('missing usage charged conservatively and timeout audited', async t => {
  const f = await fixture(t, { timeoutMs: 100 }); await f.create(); const token = await f.login();
  assert.equal((await f.chat(token, { testCase: 'missing-usage' })).status, 200);
  const record = f.db.read().requests[0]; assert.equal(record.total_tokens, null); assert.equal(record.charged_tokens, record.reserved_tokens);
  assert.equal((await f.chat(token, { testCase: 'timeout' })).status, 504);
  assert.equal(f.db.read().requests[1].error_code, 'UPSTREAM_TIMEOUT');
});

test('key import atomicity, encryption, replacement and model reassignment', async t => {
  const f = await fixture(t), user = await f.create(), token = await f.login();
  assert.equal((await f.request('/admin/keys', 'POST', { keys: [{ name: 'a', apiKey: 'new-secret' }, { name: 'b', apiKey: 'new-secret' }] }, f.admin)).status, 409);
  assert.equal(f.db.read().keys.length, 1); assert.doesNotMatch(JSON.stringify(f.db.read()), /secret-provider-key/);
  assert.equal((await f.request(`/admin/keys/${f.key.id}`, 'DELETE', undefined, f.admin)).status, 409);
  await f.request(`/admin/keys/${f.key.id}`, 'PATCH', { apiKey: 'replacement-key' }, f.admin);
  await f.chat(token); assert.equal(f.received().auth, 'Bearer replacement-key');
  assert.equal((await f.request(`/admin/keys/${f.key.id}/check`, 'POST', {}, f.admin)).body.health, 'reachable');
  await f.request(`/admin/users/${user.id}`, 'PATCH', { keyId: null }, f.admin);
  assert.equal((await f.chat(token)).body.error.code, 'KEY_UNAVAILABLE');
  const model = f.db.read().models[0];
  await f.request(`/admin/models/${model.id}`, 'PUT', { name: 'Changed', publicName: 'qcode-model', upstreamModel: 'changed-model', baseUrl: model.base_url, isDefault: true }, f.admin);
  await f.request(`/admin/users/${user.id}`, 'PATCH', { keyId: f.key.id }, f.admin);
  await f.chat(token); assert.equal(f.received().body.model, 'changed-model');
});

test('invalid batch rolls back and malformed fields are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/admin/users/import', 'POST', { users: [{ username: 'bob', password: 'user-password' }, { username: 'bob', password: 'user-password' }] }, f.admin)).status, 409);
  assert.equal(f.db.read().users.length, 1);
  assert.equal((await f.request('/admin/users', 'POST', { username: '../escape', password: 'user-password' }, f.admin)).status, 400);
  assert.equal((await f.request('/admin/users', 'POST', { username: 'test', password: 'user-password', quotas: { totalTokens: -1 } }, f.admin)).status, 400);
});

test('login rate limit and administrator source restriction', async t => {
  const f = await fixture(t, { adminAddresses: ['192.0.2.1'] });
  assert.equal((await f.request('/admin/system', 'GET', undefined, f.admin)).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/auth/login', 'POST', { username: 'no', password: 'wrong' })).status, 401);
  assert.equal((await f.request('/auth/login', 'POST', { username: 'no', password: 'wrong' })).status, 429);
});

test('legacy migration encrypts keys; persistence, lock and transaction rollback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-test-')), filename = path.join(dir, 'data.json'), vault = createVault(encryptionSecret);
  try {
    fs.writeFileSync(filename, JSON.stringify({ users: [{ id: 4, username: 'old', password_hash: hashPassword('old-password'), role: 'user', api_key: 'legacy-secret', quota_limit: 20, quota_used: 3 }], tokens: [] }));
    const db = createDatabase(filename, { vault });
    assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), /legacy-secret/); assert.equal(vault.decrypt(db.read().keys[0].secret), 'legacy-secret');
    assert.throws(() => createDatabase(filename, { vault }), /locked/);
    assert.throws(() => db.transaction(s => { s.users = []; throw new Error('rollback'); })); assert.equal(db.read().users.length, 1); db.close();
    const reopened = createDatabase(filename, { vault }); assert.equal(reopened.read().users[0].legacy_tokens, 3); reopened.close();
    assert.throws(() => createDatabase(filename, { vault: createVault('b'.repeat(64)) })); assert.equal(fs.existsSync(filename + '.lock'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configuration validates encryption, URLs and numeric values', () => {
  assert.throws(() => readConfig({}), /KEY_ENCRYPTION_SECRET/);
  assert.throws(() => readConfig({ KEY_ENCRYPTION_SECRET: encryptionSecret, UPSTREAM_BASE_URL: 'https://a:b@example.com' }), /base URL/);
  assert.throws(() => readConfig({ KEY_ENCRYPTION_SECRET: encryptionSecret, PORT: '-1' }), /PORT/);
});

test('calendar boundaries use configured timezone and reset preserves history', () => {
  const user = { id: 1, legacy_tokens: 2, quotas: quotas() };
  const state = { requests: [
    { user_id: 1, started_at: '2026-09-30T15:59:59Z', charged_tokens: 3 },
    { user_id: 1, started_at: '2026-09-30T16:00:00Z', charged_tokens: 5 },
    { user_id: 1, started_at: '2026-10-01T16:00:00Z', reserved_tokens: 7 },
    { user_id: 2, started_at: '2026-10-01T16:00:00Z', charged_tokens: 100 },
  ] };
  assert.deepEqual(consumption(state, user, 'Asia/Shanghai', '2026-10-01T17:00:00Z'), {
    totalTokens: 17, totalRequests: 3, monthlyTokens: 12, monthlyRequests: 2, dailyTokens: 7, dailyRequests: 1,
  });
  user.quota_reset_at = '2026-10-01T00:00:00Z'; user.legacy_tokens = 0;
  assert.equal(consumption(state, user, 'Asia/Shanghai', '2026-10-01T17:00:00Z').totalTokens, 7);
  assert.equal(state.requests.length, 4);
});

test('truncated streams fail and do not leave an in-flight request', async t => {
  const f = await fixture(t); await f.create(); const token = await f.login();
  try {
    const response = await fetch(f.url + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ model: 'qcode-model', messages: [{}], stream: true, testCase: 'truncated', max_tokens: 10 }) });
    await response.text();
  } catch { /* An already-started SSE response is terminated on protocol failure. */ }
  for (let i = 0; i < 30 && f.db.read().requests[0]?.status === 'pending'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.notEqual(f.db.read().requests[0].status, 'pending');
  assert.notEqual(f.db.read().requests[0].status, 'success');
  assert.equal((await f.chat(token)).status, 200);
});

test('restart marks interrupted requests and preserves their reservations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-restart-')), filename = path.join(dir, 'db.json');
  try {
    const db = createDatabase(filename);
    db.transaction(s => s.requests.push({ id: 'request', status: 'pending', reserved_tokens: 999 })); db.close();
    const reopened = createDatabase(filename);
    assert.equal(reopened.read().requests[0].status, 'interrupted');
    assert.equal(reopened.read().requests[0].charged_tokens, 999); reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
