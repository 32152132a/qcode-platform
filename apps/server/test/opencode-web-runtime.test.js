import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture } from './gateway.test.js';
import { GatewaySession, startBridge } from '../../client/bridge.mjs';
import { prepareOpenCodeLaunch } from '../../client/opencode-launch.mjs';
import { startOpenCodeWeb, waitForOpenCodeServer } from '../../client/opencode-web.mjs';

test('official Web serves UI, sends a gateway prompt and shares its session with CLI', {
  skip: !process.env.QCODE_TEST_OPENCODE_ENTRY, timeout: 120000,
}, async t => {
  const f = await fixture(t); await f.create();
  const login = (await f.request('/auth/login', 'POST', { username: 'alice', password: 'user-password' })).body;
  const bridge = await startBridge(new GatewaySession(f.url, login, () => {})); t.after(() => bridge.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-opencode-web-'));
  const workdir = path.join(root, 'workspace'); fs.mkdirSync(workdir);
  const options = { entry: process.env.QCODE_TEST_OPENCODE_ENTRY, home: path.join(root, 'home'), config: bridge.configuration, baseUrl: bridge.baseUrl, token: bridge.token };
  const launch = prepareOpenCodeLaunch({ ...options, mode: 'web' });
  const child = spawn(launch.command, launch.args, { cwd: workdir, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); fs.writeFileSync(path.join(root, 'server.log'), errors); });
  const upstreamUrl = await waitForOpenCodeServer(child);
  assert.equal((await fetch(upstreamUrl + '/session')).status, 401);
  const web = await startOpenCodeWeb({ upstreamUrl, username: launch.env.OPENCODE_SERVER_USERNAME, password: launch.env.OPENCODE_SERVER_PASSWORD, workdir });
  t.after(() => web.close());
  const auth = await fetch(web.origin + '/_qcode/login', { method: 'POST', headers: { Origin: web.origin }, body: new URL(web.url).hash.slice(1) });
  assert.equal(auth.status, 204);
  const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  async function request(route, method = 'GET', body) {
    const response = await fetch(web.origin + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    const text = await response.text(); assert.equal(response.status, 200, text); return JSON.parse(text);
  }
  assert.equal((await request('/global/health')).healthy, true);
  const session = await request('/session', 'POST', { title: 'QCode Web verification' });
  assert.ok(session.id);
  const reply = await request(`/session/${session.id}/message`, 'POST', { parts: [{ type: 'text', text: 'QCODE_WEB_FIRST: Say hello.' }] });
  assert.match(JSON.stringify(reply), /\u4f60\u597d|你好/);
  const sessions = await request('/session'); assert.ok(sessions.some(item => item.id === session.id));
  const page = await fetch(web.origin + '/', { headers, signal: AbortSignal.timeout(25000) });
  assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /<html|<!doctype/i);
  fs.writeFileSync(path.join(root, 'index.html'), html);
  if (process.env.QCODE_TEST_BROWSER_ENTRY) {
    const browser = spawn(process.env.QCODE_TEST_BROWSER_ENTRY, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(root, 'browser-profile'), '--dump-dom', '--virtual-time-budget=8000', web.url], { windowsHide: true, env: { ...process.env, TEMP: path.join(root, 'home', 'tmp'), TMP: path.join(root, 'home', 'tmp') } });
    let dom = ''; browser.stdout.on('data', chunk => { dom += chunk; }); browser.stderr.resume();
    const browserTimer = setTimeout(() => browser.kill(), 35000);
    t.after(() => { if (browser.exitCode === null) browser.kill(); });
    const browserCode = await new Promise((resolve, reject) => { browser.once('exit', resolve); browser.once('error', reject); }).finally(() => clearTimeout(browserTimer));
    fs.writeFileSync(path.join(root, 'browser-dom.html'), dom);
    assert.equal(browserCode, 0, 'Headless browser failed');
    assert.match(dom, /contenteditable|<textarea/i, 'Browser did not reach the conversation input; see browser-dom.html');
  }
  await web.close(); const exited = once(child, 'exit'); child.kill(); await exited;
  const terminal = prepareOpenCodeLaunch(options);
  const cli = spawn(terminal.command, ['run', '--session', session.id, 'QCODE_WEB_RESUME: Say hello again.'], { cwd: workdir, env: terminal.env, windowsHide: true });
  cli.stdin.end(); let output = '';
  cli.stdout.on('data', chunk => { output += chunk; }); cli.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => cli.kill(), 30000);
  t.after(() => { if (cli.exitCode === null) cli.kill(); });
  const code = await new Promise((resolve, reject) => { cli.once('exit', resolve); cli.once('error', reject); }).finally(() => clearTimeout(timer));
  fs.writeFileSync(path.join(root, 'continued.log'), output); assert.equal(code, 0, output);
  assert.match(JSON.stringify(f.received().body.messages), /QCODE_WEB_FIRST/);
  const usage = (await f.request('/admin/usage', 'GET', undefined, f.admin)).body;
  assert.equal(usage.totals.failed, 0); assert.equal(usage.totals.tokens, f.calls() * 5);
  console.log(`OpenCode Web verification artifacts: ${root}`);
});
