import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { registerWebPages } from '../src/web-pages.js';

test('history page routes refresh correctly without swallowing API or asset errors', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-pages-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><div id="app">QCode shell</div>');
  fs.writeFileSync(path.join(directory, 'assets', 'app.js'), 'window.qcode=true;');
  const app = express();
  registerWebPages(app, { directory });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/admin', (_req, res) => res.status(401).json({ error: 'AUTH_REQUIRED' }));
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/login', '/download', '/manage', '/manage/models?tab=relay', '/console/', '/console/manage/models']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /QCode shell/);
  }
  for (const route of ['/assets/app.js', '/console/assets/app.js']) {
    assert.equal(await (await fetch(base + route)).text(), 'window.qcode=true;');
  }
  assert.equal((await fetch(base + '/admin/users')).status, 401);
  assert.deepEqual(await (await fetch(base + '/health')).json(), { status: 'ok' });
  for (const route of ['/v1/missing', '/auth/missing', '/client/missing', '/downloads/missing', '/assets/missing.js', '/manage/missing.js']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(await response.text(), /QCode shell/);
  }
  assert.equal((await fetch(base + '/login', { method: 'POST' })).status, 404);
  fs.unlinkSync(path.join(directory, 'index.html'));
  assert.equal((await fetch(base + '/')).status, 503);
});
