import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startOpenCodeWeb } from '../../client/opencode-web.mjs';

test('local Web gate protects browser sessions and forwards authenticated HTTP and upgrades', async t => {
  const upstream = http.createServer((req, res) => res.end(JSON.stringify({ auth: req.headers.authorization, cookie: req.headers.cookie, directory: req.headers['x-opencode-directory'], url: req.url })));
  upstream.on('upgrade', (req, socket) => {
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('qcode:local-password').toString('base64'));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', data => socket.write(data));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const web = await startOpenCodeWeb({ upstreamUrl: `http://127.0.0.1:${upstream.address().port}`, username: 'qcode', password: 'local-password', workdir: 'D:/test workspace' });
  t.after(() => web.close());
  assert.equal((await fetch(web.origin + '/session')).status, 401);
  const bootstrap = await fetch(web.url.split('#')[0]); assert.equal(bootstrap.status, 200);
  assert.match(await bootstrap.text(), /history.replaceState/);
  const token = new URL(web.url).hash.slice(1);
  for (const origin of ['https://foreign.example', 'null']) assert.equal((await fetch(web.origin + '/_qcode/login', { method: 'POST', headers: { Origin: origin }, body: token })).status, 403);
  assert.equal((await fetch(web.origin + '/_qcode/login', { method: 'POST', headers: { Origin: web.origin }, body: 'wrong' })).status, 401);
  const login = await fetch(web.origin + '/_qcode/login', { method: 'POST', headers: { Origin: web.origin }, body: token });
  assert.equal(login.status, 204);
  const setCookie = login.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await fetch(web.origin + '/session', { headers: { Cookie: cookie, Origin: 'https://foreign.example' } })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    const req = http.get(web.origin + '/session', { headers: { Cookie: cookie, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(invalidHost, 403);
  const result = await (await fetch(web.origin + '/session?limit=10', { headers: { Cookie: cookie, Authorization: 'Bearer attacker-value' } })).json();
  assert.equal(result.auth, 'Basic ' + Buffer.from('qcode:local-password').toString('base64'));
  assert.equal(result.cookie, undefined); assert.equal(result.directory, encodeURIComponent('D:/test workspace'));
  assert.equal(result.url, '/session?limit=10');
  await new Promise((resolve, reject) => {
    const req = http.request(web.origin + '/pty/test/connect', { headers: { Cookie: cookie, Origin: web.origin, Upgrade: 'websocket', Connection: 'Upgrade' } });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('Upgrade timeout')); }, 3000);
    req.on('error', reject);
    req.on('upgrade', (res, socket) => {
      socket.once('data', data => { assert.equal(data.toString(), 'tunnel-ok'); clearTimeout(timer); socket.destroy(); resolve(); });
      socket.write('tunnel-ok');
    }); req.end();
  });
  await web.close(); await assert.rejects(fetch(web.origin + '/session'));
});
