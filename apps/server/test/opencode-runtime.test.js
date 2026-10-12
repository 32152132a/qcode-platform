import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture } from './gateway.test.js';
import { GatewaySession, startBridge } from '../../client/bridge.mjs';
import { prepareOpenCodeLaunch } from '../../client/opencode-launch.mjs';

test('official OpenCode runs through QCode login, bridge and accounted gateway', { skip: !process.env.QCODE_TEST_OPENCODE_ENTRY, timeout: 90000 }, async t => {
  const f = await fixture(t); await f.create();
  const login = (await f.request('/auth/login', 'POST', { username: 'alice', password: 'user-password' })).body;
  const session = new GatewaySession(f.url, login, () => {});
  const bridge = await startBridge(session); t.after(() => bridge.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-opencode-runtime-'));
  const launch = prepareOpenCodeLaunch({ entry: process.env.QCODE_TEST_OPENCODE_ENTRY, home: root, config: bridge.configuration, baseUrl: bridge.baseUrl, token: bridge.token });
  let output = '';
  const child = spawn(launch.command, ['run', '--print-logs', '--log-level', 'DEBUG', 'Say hello briefly'], { cwd: root, env: launch.env, windowsHide: true });
  // The CLI consumes piped stdin before sending its prompt; provide EOF.
  child.stdin.end();
  t.after(() => { if (child.exitCode === null) child.kill(); });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 60000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timeout));
  fs.writeFileSync(path.join(root, 'runtime-output.txt'), output);
  assert.equal(code, 0, `Gateway requests: ${f.calls()}\n${output}`);
  assert.match(output, /\u4f60\u597d/);
  assert.ok(f.calls() > 0);
  assert.equal(f.received().auth, 'Bearer secret-provider-key');
  assert.equal(f.received().body.model, 'private-model');
  const usage = (await f.request('/admin/usage', 'GET', undefined, f.admin)).body;
  assert.match(JSON.stringify(usage), /alice/);
  assert.equal(usage.totals.success, f.calls());
  assert.equal(usage.totals.failed, 0);
  assert.equal(usage.totals.tokens, f.calls() * 5);
});
