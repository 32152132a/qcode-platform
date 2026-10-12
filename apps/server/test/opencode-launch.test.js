import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareOpenCodeLaunch } from '../../client/opencode-launch.mjs';

test('OpenCode isolates accounts and overrides inherited provider configuration without persisting credentials', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-opencode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { entry: process.execPath, home: path.join(root, 'alice'), config: { model: 'Company model', contextWindow: 131072, maxOutputTokens: 4096 }, baseUrl: 'http://127.0.0.1:12345/v1', token: 'local-test-token', environment: { PATH: 'tools', OPENCODE_CONFIG: 'untrusted.json', OPENCODE_DB: 'shared.db', OPENAI_API_KEY: 'provider-secret' } };
  const first = prepareOpenCodeLaunch(options);
  const second = prepareOpenCodeLaunch({ ...options, home: path.join(root, 'bob') });
  const config = JSON.parse(first.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.enabled_providers, ['qcode']);
  assert.equal(config.provider.qcode.options.apiKey, 'local-test-token');
  assert.equal(config.provider.qcode.options.baseURL, options.baseUrl);
  assert.equal(config.model, config.small_model);
  assert.equal(config.autoupdate, false);
  assert.equal(config.share, 'disabled');
  assert.equal(first.env.OPENCODE_CONFIG, undefined);
  assert.equal(first.env.OPENCODE_DB, undefined);
  assert.equal(first.env.OPENAI_API_KEY, undefined);
  assert.equal(first.env.PATH, 'tools');
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'TEMP']) {
    assert.notEqual(first.env[key], second.env[key]);
    assert.ok(fs.statSync(first.env[key]).isDirectory());
  }
  assert.deepEqual(first.args, []);
  assert.deepEqual(fs.readdirSync(first.env.XDG_CONFIG_HOME), []);
  assert.throws(() => prepareOpenCodeLaunch({ ...options, baseUrl: 'https://models.example/v1' }), /local QCode bridge/);
  const web = prepareOpenCodeLaunch({ ...options, mode: 'web' });
  assert.deepEqual(web.args, ['serve', '--hostname', '127.0.0.1', '--port', '0', '--no-mdns']);
  assert.ok(web.env.OPENCODE_SERVER_PASSWORD.length >= 32);
  assert.notEqual(web.env.OPENCODE_SERVER_PASSWORD, options.token);
  assert.equal(web.env.XDG_DATA_HOME, first.env.XDG_DATA_HOME);
  assert.throws(() => prepareOpenCodeLaunch({ ...options, mode: 'invalid' }), /Unsupported/);
  assert.throws(() => prepareOpenCodeLaunch({ ...options, entry: path.join(root, 'missing.exe') }), /missing/);
});
