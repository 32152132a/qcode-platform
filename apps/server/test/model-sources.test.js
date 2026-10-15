import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { fixture } from './gateway.test.js'
import { selectSourceModels } from '../src/model-sources.js'
test('model source switch blocks all new requests while preserving model identities and history', async (t) => {
  const f = await fixture(t)
  await f.create()
  const token = await f.login(),
    before = f.db.read().models[0]
  const source = (await f.request('/admin/models/sources', 'GET', undefined, f.admin)).body[0]
  assert.equal(before.source_id, source.id)
  assert.equal((await f.chat(token)).status, 200)
  const count = f.db.read().requests.length
  assert.equal(
    (await f.request('/admin/models/sources/' + source.id, 'PUT', { active: false }, f.admin))
      .status,
    200
  )
  assert.deepEqual((await f.request('/client/config', 'GET', undefined, token)).body.models, [])
  assert.equal((await f.chat(token)).body.error.code, 'MODEL_UNAVAILABLE')
  assert.equal(f.db.read().requests.length, count)
  await f.request('/admin/models/sources/' + source.id, 'PUT', { active: true }, f.admin)
  assert.equal((await f.chat(token)).status, 200)
  assert.equal(f.db.read().models[0].id, before.id)
})
test('source discovery scopes credentials and preserves edits, disables retired models and falls back on failure', async (t) => {
  const f = await fixture(t)
  let fail = false,
    models = ['gpt-5', 'claude-sonnet-4', 'gemini-2.5-pro', 'text-embedding-3']
  const received = []
  const upstream = http.createServer((req, res) => {
    received.push(req.headers.authorization)
    res
      .writeHead(fail ? 503 : 200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: models.map((id) => ({ id })) }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => {
    upstream.closeAllConnections()
    upstream.close()
  })
  const source = (
    await f.request(
      '/admin/models/sources',
      'POST',
      {
        kind: 'relay',
        name: 'Test relay',
        baseUrl: 'http://127.0.0.1:' + upstream.address().port,
        apiKey: 'test-private-relay-secret',
      },
      f.admin
    )
  ).body
  assert.doesNotMatch(JSON.stringify(source), /test-private-relay-secret/)
  const sync = () => f.request('/admin/models/sources/' + source.id + '/sync', 'POST', {}, f.admin)
  assert.equal((await sync()).status, 200)
  assert.equal(received[0], 'Bearer test-private-relay-secret')
  let saved = f.db.read().models.filter((m) => m.source_id === source.id)
  assert.equal(saved.length, 3)
  assert(saved.every((m) => !m.active))
  const gpt = saved.find((m) => m.upstream_model === 'gpt-5')
  await f.request(
    '/admin/models/sources/' + source.id + '/models/' + gpt.id,
    'PATCH',
    { name: 'Custom name', active: true, maxOutputTokens: 1024 },
    f.admin
  )
  await sync()
  let current = f.db.read().models.find((m) => m.id === gpt.id)
  assert.equal(current.name, 'Custom name')
  assert.equal(current.active, true)
  assert.equal(current.max_output_tokens, 1024)
  models = ['claude-sonnet-4']
  await sync()
  assert.equal(f.db.read().models.find((m) => m.id === gpt.id).catalog_available, false)
  fail = true
  assert.equal((await sync()).status, 502)
  assert.equal(f.db.read().models.filter((m) => m.source_id === source.id).length, 3)
  assert.equal(
    (await f.request('/admin/keys/' + source.key_id, 'DELETE', undefined, f.admin)).status,
    409
  )
  await f.create()
  const token = await f.login()
  assert.equal((await f.request('/admin/models/sources', 'POST', {}, token)).status, 403)
})
test('recommended models exclude non-text endpoints and prefer stable numeric versions', () => {
  const rows = [
    'gpt-5-preview',
    'gpt-4.9',
    'gpt-5.1',
    'gpt-image-1',
    'text-embedding-3',
    'gemini-3-pro',
    'qwen:0.5b',
  ].map((id) => ({ id }))
  assert.deepEqual(
    selectSourceModels(rows, 'relay').map((m) => m.id),
    ['gpt-5.1', 'gemini-3-pro']
  )
  assert.deepEqual(
    selectSourceModels(rows, 'local').map((m) => m.id),
    ['qwen:0.5b']
  )
})

test('source migration snapshot is encrypted and compatible with the existing restore tool', async (t) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { createVault } = await import('../src/database.js')
  const { backupBeforeModelSources } = await import('../src/model-sources.js')
  const { restoreDatabase } = await import('../src/maintenance.js')
  const f = await fixture(t),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-source-backup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const state = f.db.read()
  delete state.settings.modelSources
  for (const model of state.models) delete model.source_id
  const vault = createVault('a'.repeat(64))
  const backup = backupBeforeModelSources(
    { kind: 'sqlite-wal', read: () => state, export: () => state },
    vault,
    { dbPath: path.join(root, 'old.sqlite') }
  )
  const raw = fs.readFileSync(backup, 'utf8')
  assert.doesNotMatch(raw, /secret-provider-key|admin-password/)
  const restored = restoreDatabase(backup, path.join(root, 'restored.sqlite'), 'a'.repeat(64))
  assert.equal(restored.users, 1)
  assert.equal(restored.requests, 0)
})
