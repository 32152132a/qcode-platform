import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fixture } from './gateway.test.js';
import { GatewaySession, startBridge } from '../../client/bridge.mjs';
import { prepareOpenCodeLaunch } from '../../client/opencode-launch.mjs';

test('OpenCode creates and edits files, executes a command and resumes the session through QCode', {
  skip: !process.env.QCODE_TEST_OPENCODE_ENTRY, timeout: 120000,
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-opencode-tools-'));
  const workdir = path.join(root, 'workspace'); fs.mkdirSync(workdir);
  const target = path.join(workdir, 'verification.txt');
  const actions = [
    { name: 'write', arguments: { filePath: target, content: 'QCODE_BEFORE\n' } },
    { name: 'edit', arguments: { filePath: target, oldString: 'QCODE_BEFORE', newString: 'QCODE_AFTER' } },
    { name: 'bash', arguments: { command: 'echo QCODE_EXECUTED > executed.txt', description: 'Create the test execution marker' } },
  ];
  const requests = []; let continued = false;
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ body, auth: req.headers.authorization });
    const hasTools = body.tools?.length > 0;
    const results = body.messages.filter(message => message.role === 'tool');
    const resume = body.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('QCODE_RESUME'));
    if (resume && results.length >= actions.length) continued = true;
    const action = hasTools && !resume ? actions[results.length] : undefined;
    const content = resume ? 'QCODE_RESUMED' : hasTools ? 'QCODE_TOOLS_DONE' : 'QCode verification';
    const message = action
      ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${results.length}`, type: 'function', function: { name: action.name, arguments: JSON.stringify(action.arguments) } }] }
      : { role: 'assistant', content };
    const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
    if (!body.stream) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'private-model', choices: [{ index: 0, message, finish_reason: action ? 'tool_calls' : 'stop' }], usage }));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = action ? { ...message, tool_calls: message.tool_calls.map(call => ({ index: 0, ...call })) } : message;
    const envelope = { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'private-model' };
    for (const chunk of [
      { ...envelope, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...envelope, choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }] },
      { ...envelope, choices: [], usage },
    ]) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const f = await fixture(t, { baseUrl: `http://127.0.0.1:${upstream.address().port}`, timeoutMs: 10000 });
  await f.create();
  const login = (await f.request('/auth/login', 'POST', { username: 'alice', password: 'user-password' })).body;
  const bridge = await startBridge(new GatewaySession(f.url, login, () => {})); t.after(() => bridge.close());
  const launch = prepareOpenCodeLaunch({ entry: process.env.QCODE_TEST_OPENCODE_ENTRY, home: path.join(root, 'home'), config: bridge.configuration, baseUrl: bridge.baseUrl, token: bridge.token });
  async function run(args, logName) {
    // Permission bypass is confined to this mock-model test and its fixed harmless commands.
    const child = spawn(launch.command, ['run', '--dangerously-skip-permissions', ...args], { cwd: workdir, env: launch.env, windowsHide: true });
    child.stdin.end(); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill(), 45000);
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timer));
    fs.writeFileSync(path.join(root, logName), output);
    assert.equal(code, 0, output); return output;
  }
  const first = await run(['QCODE_FIRST: create, edit and execute the verification files.'], 'first.log');
  assert.match(first, /QCODE_TOOLS_DONE/);
  assert.equal(fs.readFileSync(target, 'utf8').trim(), 'QCODE_AFTER');
  assert.equal(fs.readFileSync(path.join(workdir, 'executed.txt'), 'utf8').trim(), 'QCODE_EXECUTED');
  const second = await run(['--continue', 'QCODE_RESUME: continue our previous verification.'], 'continued.log');
  assert.match(second, /QCODE_RESUMED/); assert.ok(continued, 'Previous tool results were missing from the resumed session');
  assert.ok(requests.every(request => request.auth === 'Bearer secret-provider-key' && request.body.model === 'private-model'));
  const usage = (await f.request('/admin/usage', 'GET', undefined, f.admin)).body;
  assert.equal(usage.totals.success, requests.length); assert.equal(usage.totals.failed, 0);
  assert.equal(usage.totals.tokens, requests.length * 5);
  console.log(`OpenCode tool verification artifacts: ${root}`);
});
