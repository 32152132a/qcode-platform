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
test('synced models exclude non-text and test variants while preserving upstream order', () => {
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
    ['gpt-4.9', 'gpt-5.1', 'gemini-3-pro', 'qwen:0.5b']
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

test('relay sync selects the first 30 distinct eligible models and keeps official Pro and Flash', () => {
  const standard = [
    'claude-opus-4-5',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    ...Array.from({ length: 40 }, (_, i) => 'model-' + i),
  ]
  const rejected = [
    'gpt-image-1',
    'text-embedding-3',
    'claude-opus-4-5-channel',
    'claude-opus-4-5-2x',
    'gpt-test',
    'gemini-3-pro-preview',
    'model-渠道',
    'model-2.5x',
    'model-beta',
    'model-aws',
  ]
  const rows = [...rejected, standard[0], ...standard].map((id) => ({ id }))
  rows.unshift({ id: 'non-chat', supported_endpoint_types: ['image'] })
  const ids = selectSourceModels(rows, 'relay').map((model) => model.id)
  assert.deepEqual(ids, standard.slice(0, 30))
  assert.equal(ids.length, 30)
  assert.deepEqual(
    selectSourceModels([{ id: 'claude-opus-4-5-20251101' }], 'relay').map((model) => model.id),
    ['claude-opus-4-5-20251101']
  )
})

test('resync refreshes recommendation flags without removing configured models or resetting user choices', async (t) => {
  const f = await fixture(t)
  let ids = ['claude-sonnet-4-5', 'claude-opus-4-5-thinking']
  const upstream = http.createServer((_req, res) =>
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: ids.map((id) => ({ id })) }))
  )
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
        name: 'Recommendation fixture',
        baseUrl: 'http://127.0.0.1:' + upstream.address().port,
        apiKey: 'fake-source-key',
      },
      f.admin
    )
  ).body
  const existing = f.db.read().models.find((model) => model.source_id === source.id)
  assert.equal(existing.upstream_model, 'claude-sonnet-4-5')
  await f.request(
    '/admin/models/sources/' + source.id + '/models/' + existing.id,
    'PATCH',
    { name: '团队常用模型', active: true, maxOutputTokens: 1024 },
    f.admin
  )
  ids = [
    'claude-opus-4-5',
    ...Array.from({ length: 35 }, (_, i) => 'standard-model-' + i),
    'claude-sonnet-4-5',
  ]
  assert.equal(
    (await f.request('/admin/models/sources/' + source.id + '/sync', 'POST', {}, f.admin)).status,
    200
  )
  const saved = f.db.read().models.filter((model) => model.source_id === source.id)
  const preserved = saved.find((model) => model.id === existing.id)
  assert.equal(preserved.name, '团队常用模型')
  assert.equal(preserved.active, true)
  assert.equal(preserved.max_output_tokens, 1024)
  assert.equal(preserved.recommended, false)
  assert.equal(preserved.catalog_available, true)
  assert(
    saved.some(
      (model) => model.upstream_model === 'claude-opus-4-5' && model.recommended && !model.active
    )
  )
})

test('client model names do not expose source labels and model display names are unique on create and rename', async (t) => {
  const f = await fixture(t)
  await f.create()
  const token = await f.login()
  const first = f.db.read().models[0]
  const originalSource = f.db
    .read()
    .settings.modelSources.find((source) => source.id === first.source_id)
  assert(originalSource)
  const config = (await f.request('/client/config', 'GET', undefined, token)).body
  assert.equal(config.models.find((model) => model.id === first.public_name).name, first.name)
  assert.doesNotMatch(JSON.stringify(config.models), new RegExp(originalSource.name))
  const base = {
    upstreamModel: 'test-upstream',
    baseUrl: first.base_url,
    keyId: first.key_id,
    publicName: 'another-public-model',
    active: false,
    name: 'Team Model',
  }
  assert.equal((await f.request('/admin/models', 'POST', base, f.admin)).status, 201)
  const duplicate = await f.request(
    '/admin/models',
    'POST',
    { ...base, publicName: 'unique-id', name: '  team model  ' },
    f.admin
  )
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error.code, 'MODEL_NAME_EXISTS')
  const rename = await f.request(
    '/admin/models/' + first.id,
    'PUT',
    {
      name: 'Ｔｅａｍ Model',
      publicName: first.public_name,
      upstreamModel: first.upstream_model,
      baseUrl: first.base_url,
      keyId: first.key_id,
    },
    f.admin
  )
  assert.equal(rename.status, 409)
  assert.equal(f.db.read().models.find((model) => model.id === first.id).name, first.name)
  const unchanged = await f.request(
    '/admin/models/' + first.id,
    'PUT',
    {
      name: first.name,
      publicName: first.public_name,
      upstreamModel: first.upstream_model,
      baseUrl: first.base_url,
      keyId: first.key_id,
    },
    f.admin
  )
  assert.equal(unchanged.status, 200)
})

test('source names are unique across categories and rejected renames leave configuration intact', async (t) => {
  const f = await fixture(t)
  const create = await f.request(
    '/admin/models/sources',
    'POST',
    { kind: 'relay', name: 'Team Relay', baseUrl: 'https://example.invalid/v1', autoSync: false },
    f.admin
  )
  assert.equal(create.status, 201)
  const source = create.body
  const duplicate = await f.request(
    '/admin/models/sources',
    'POST',
    { kind: 'local', name: '  team relay ', autoSync: false },
    f.admin
  )
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error.code, 'SOURCE_NAME_EXISTS')
  const original = f.db.read().settings.modelSources.find((item) => item.id !== source.id)
  assert.equal(
    (
      await f.request(
        '/admin/models/sources/' + original.id,
        'PUT',
        { name: 'TEAM RELAY' },
        f.admin
      )
    ).status,
    409
  )
  assert.equal(
    f.db.read().settings.modelSources.find((item) => item.id === original.id).name,
    original.name
  )
  assert.equal(
    (
      await f.request(
        '/admin/models/sources/' + source.id,
        'PUT',
        { name: 'Team Relay', active: false },
        f.admin
      )
    ).status,
    200
  )
})

test('discovering identical upstream IDs across sources creates distinct names without resetting existing choices', async (t) => {
  const f = await fixture(t)
  const upstream = http.createServer((_req, res) =>
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ id: 'claude-opus-4-5' }] }))
  )
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => {
    upstream.closeAllConnections()
    upstream.close()
  })
  const address = 'http://127.0.0.1:' + upstream.address().port
  for (const name of ['Source A', 'Source B'])
    assert.equal(
      (
        await f.request(
          '/admin/models/sources',
          'POST',
          { kind: 'relay', name, baseUrl: address, apiKey: 'fixture-key' },
          f.admin
        )
      ).status,
      201
    )
  const models = f.db.read().models.filter((model) => model.upstream_model === 'claude-opus-4-5')
  assert.equal(models.length, 2)
  assert.deepEqual(
    models.map((model) => model.name),
    ['claude-opus-4-5', 'claude-opus-4-5 (2)']
  )
  assert(models.every((model) => !model.active))
  assert.equal(new Set(models.map((model) => model.public_name)).size, 2)
  for (const model of models)
    assert.equal(
      (await f.request('/admin/models/sources/' + model.source_id + '/sync', 'POST', {}, f.admin))
        .status,
      200
    )
  assert.equal(
    f.db.read().models.filter((model) => model.upstream_model === 'claude-opus-4-5').length,
    2
  )
})
