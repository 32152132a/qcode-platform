import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { startBridge, GatewaySession } from '../../client/bridge.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=';
async function fixture(t, extraConfig = {}) {
  const received = []; let mode = 'ok';
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
    if (mode === 'stall') return;
    if (mode === '401') return res.writeHead(401).end('private-test-key should not leak');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [mode === 'url' ? { url: 'http://127.0.0.1/private' } : mode === 'invalid' ? { b64_json: Buffer.from('<svg/>').toString('base64') } : { b64_json: png }] }));
  }); upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const db = createDatabase();
  const app = createApp({ encryptionSecret: 'a'.repeat(64), adminUsername: 'admin', adminPassword: 'administrator-test', demoEnabled: true, ...extraConfig }, db);
  const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function post(path, body = {}, token) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const session = (await post('/auth/login', { username: 'admin', password: 'administrator-test' })).body;
  const source = (await post('/admin/models/sources/create', { name: 'Image relay', kind: 'relay', baseUrl: 'http://127.0.0.1:' + upstream.address().port + '/v1', apiKey: 'private-test-key', autoSync: false }, session.token)).body;
  const configure = extra => post('/admin/models/images/settings/update', { enabled: true, sourceId: source.id, model: 'gpt-image-2', dailyImagesPerUser: 2, ...extra }, session.token);
  return { db, post, session, source, configure, received, base, mode(value) { mode = value; } };
}
test('image generation is off by default, authenticated, server selected and request-counted without fake tokens', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/v1/images/generations', { prompt: 'test' })).status, 401);
  assert.equal((await f.post('/v1/images/generations', { prompt: 'test' }, f.session.token)).body.error.code, 'IMAGE_GENERATION_DISABLED');
  assert.equal((await f.configure()).status, 200);
  assert.equal((await f.post('/client/images/status', {}, f.session.token)).body.enabled, true);
  const result = await f.post('/v1/images/generations', { prompt: 'Draw a tree', model: 'untrusted-client-model' }, f.session.token);
  assert.equal(result.status, 200); assert.equal(result.body.data[0].b64_json, png);
  assert.deepEqual(f.received[0], { path: '/v1/images/generations', auth: 'Bearer private-test-key', body: { model: 'gpt-image-2', prompt: 'Draw a tree', n: 1, output_format: 'png' } });
  const record = f.db.read().requests[0]; assert.equal(record.status, 'success'); assert.equal(record.generated_images, 1); assert.equal(record.charged_tokens, 0); assert.equal(record.total_tokens, null);
  assert(!JSON.stringify(result).includes('private-test-key'));
  assert.equal((await f.post('/v1/images/generations', { prompt: 'second' }, f.session.token)).status, 200);
  assert.equal((await f.post('/v1/images/generations', { prompt: 'third' }, f.session.token)).body.error.code, 'IMAGE_QUOTA_EXCEEDED');
  assert.equal(f.received.length, 2);
});
test('image configuration and generation enforce demo, user, source and request quotas', async t => {
  const f = await fixture(t); await f.configure();
  await f.post('/admin/users/create', { username: 'employee', password: 'employee-password' }, f.session.token);
  const user = (await f.post('/auth/login', { username: 'employee', password: 'employee-password' })).body;
  assert.equal((await f.post('/admin/models/images/settings/update', { enabled: false }, user.token)).status, 403);
  const demo = (await f.post('/auth/demo')).body;
  const demoSession = (await f.post('/auth/login', demo)).body;
  assert.equal((await f.post('/v1/images/generations', { prompt: 'demo' }, demoSession.token)).body.error.code, 'DEMO_READ_ONLY');
  assert.equal((await f.post('/admin/models/images/settings/detail', {}, demoSession.token)).status, 200);
  f.db.transaction(s => { s.users.find(u => u.id === user.user.id).quotas.totalRequests = 1; });
  assert.equal((await f.post('/v1/images/generations', { prompt: 'one' }, user.token)).status, 200);
  assert.equal((await f.post('/v1/images/generations', { prompt: 'two' }, user.token)).body.error.code, 'QUOTA_EXCEEDED');
  f.db.transaction(s => { s.settings.modelSources.find(s => s.id === f.source.id).active = false; });
  assert.equal((await f.post('/client/images/status', {}, user.token)).body.enabled, false);
  assert.equal((await f.post('/v1/images/generations', { prompt: 'disabled' }, f.session.token)).body.error.code, 'IMAGE_SERVICE_UNAVAILABLE');
});
test('failed providers and URL-only or non-PNG results are rejected without leaking secrets or consuming daily image allowance', async t => {
  const f = await fixture(t); await f.configure({ dailyImagesPerUser: 1 });
  for (const mode of ['401', 'url', 'invalid']) {
    f.mode(mode); const r = await f.post('/v1/images/generations', { prompt: mode }, f.session.token);
    assert.equal(r.status, 502); assert(!JSON.stringify(r).includes('private-test-key'));
    assert.equal(f.db.read().requests.at(-1).status, 'failed');
  }
  f.mode('ok'); assert.equal((await f.post('/v1/images/generations', { prompt: 'valid' }, f.session.token)).status, 200);
  assert.equal((await f.configure({ model: 123 })).status, 400);
  assert.equal((await f.post('/v1/images/generations', { prompt: 'many', n: 2 }, f.session.token)).status, 400);
});
test('desktop loopback image bridge authenticates and works without any chat models', async t => {
  const f = await fixture(t); await f.configure();
  const bridge = await startBridge(new GatewaySession(f.base, f.session, async () => {}));
  t.after(() => bridge.close());
  const response = await fetch(bridge.baseUrl + '/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + bridge.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'image only' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).data[0].b64_json, png);
  assert.equal((await fetch(bridge.baseUrl + '/images/status')).status, 401);
  const status = await fetch(bridge.baseUrl + '/images/status', { headers: { Authorization: 'Bearer ' + bridge.token } });
  assert.equal((await status.json()).enabled, true);
});

test('image timeouts release concurrency, retain a failed audit and do not retry', async t => {
  const f = await fixture(t, { timeoutMs: 100 }); await f.configure(); f.mode('stall');
  const r = await f.post('/v1/images/generations', { prompt: 'slow' }, f.session.token);
  assert.equal(r.status, 502); assert.equal(r.body.error.code, 'IMAGE_TIMEOUT');
  assert.equal(f.received.length, 1); assert.equal(f.db.read().requests[0].status, 'failed');
  f.mode('ok'); assert.equal((await f.post('/v1/images/generations', { prompt: 'after timeout' }, f.session.token)).status, 200);
});


test('image settings need no enable switch; clearing both fields stops generation and rejects half-filled settings',async t=>{
 const f=await fixture(t);
 const route='/admin/models/images/settings/update';
 assert.equal((await f.post(route,{sourceId:f.source.id,model:'gpt-image-2'},f.session.token)).status,200);
 assert.equal((await f.post('/client/images/status',{},f.session.token)).body.enabled,true);
 assert.deepEqual((await f.post('/client/images/status',{},f.session.token)).body,{enabled:true});
 assert.equal((await f.post(route,{sourceId:f.source.id,model:''},f.session.token)).status,400);
 assert.equal((await f.post(route,{sourceId:'',model:''},f.session.token)).status,200);
 assert.equal((await f.post('/client/images/status',{},f.session.token)).body.enabled,false);
 assert.equal((await f.post('/v1/images/generations',{prompt:'test'},f.session.token)).body.error.code,'IMAGE_GENERATION_DISABLED');
});
