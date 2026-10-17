import fs from 'node:fs'
import { catalogDisplayFields } from './model-presentation.js'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { id, now, text, baseUrl, fail, audit } from './domain.js'

export const sourceKinds = ['local', 'official', 'relay']
export const sourcesFor = (state) => state.settings.modelSources || []
export function migrateModelSources(state) {
  state.settings.modelSources ||= []
  for (const model of state.models) {
    if (model.source_id) continue
    const kind =
      model.provider === 'ollama'
        ? 'local'
        : /^https:\/\/api\.deepseek\.com(?:\/|$)/.test(model.base_url)
          ? 'official'
          : 'relay'
    let source = sourcesFor(state).find(
      (s) =>
        s.kind === kind &&
        s.base_url === model.base_url &&
        s.key_id === (model.key_id || null) &&
        s.protocol === (model.protocol || 'chat-completions')
    )
    if (!source) {
      source = {
        id: id(),
        kind,
        name:
          kind === 'local'
            ? '本地 Ollama'
            : kind === 'official'
              ? 'DeepSeek 官方'
              : '中转服务 ' + (sourcesFor(state).filter((s) => s.kind === 'relay').length + 1),
        base_url: model.base_url,
        key_id: model.key_id || null,
        protocol: model.protocol || 'chat-completions',
        active: true,
        auto_sync: !!model.key_id || kind === 'local',
        created_at: now(),
        revision: 1,
      }
      sourcesFor(state).push(source)
    }
    model.source_id = source.id
  }
}
function family(value) {
  value = value.replace(/^(openai|anthropic|google|x-ai|xai|deepseek)\//i, '')
  return /^deepseek/i.test(value)
    ? 'deepseek'
    : /^(gpt|o[1-9])/i.test(value)
      ? 'gpt'
      : /^claude/i.test(value)
        ? 'claude'
        : /^gemini/i.test(value)
          ? 'gemini'
          : /^grok/i.test(value)
            ? 'grok'
            : /^qwen/i.test(value)
              ? 'qwen'
              : null
}
export function catalogModelIssue(model, kind) {
  if (/(embedding|rerank|image|video|audio|tts|whisper|dall-e)/i.test(model.id))
    return '暂不支持该类模型'
  if (
    kind !== 'local' &&
    model.supported_endpoint_types?.length &&
    !model.supported_endpoint_types.some((value) =>
      ['openai', 'chat-completions', 'openai-response', 'responses', 'openai-compatible'].includes(
        String(value).toLowerCase()
      )
    )
  )
    return '上游未声明兼容的对话接口'
  return null
}
export function modelBody(model) {
  return {
    name: model.name,
    publicName: model.public_name,
    upstreamModel: model.upstream_model,
    baseUrl: model.base_url,
    provider: model.provider,
    protocol: model.protocol,
    keyId: model.key_id,
    maxOutputTokens: model.max_output_tokens,
    contextWindow: model.context_window,
    inputPrice: model.input_price,
    outputPrice: model.output_price,
    currency: model.currency,
    pricingKnown: model.pricing_known ?? true,
    maxTokensField: model.max_tokens_field,
    streamUsage: model.stream_usage,
    active: model.active,
    isDefault: model.is_default,
  }
}

export function registerModelSources(app, { db, vault, config, saveModel }) {
  const pending = new Map()
  const find = (state, value) => {
    const source = sourcesFor(state).find((s) => s.id === value)
    if (!source) fail(404, 'SOURCE_NOT_FOUND', '服务来源不存在')
    return source
  }
  function saveSource(state, body, actor, existing) {
    const name = text(body.name ?? existing?.name, '来源名称', 80)
    const nameKey = name.normalize('NFKC').toLowerCase()
    if (
      (!existing || nameKey !== existing.name.trim().normalize('NFKC').toLowerCase()) &&
      sourcesFor(state).some(
        (source) =>
          source.id !== existing?.id &&
          source.name.trim().normalize('NFKC').toLowerCase() === nameKey
      )
    )
      fail(409, 'SOURCE_NAME_EXISTS', '服务来源名称已存在，请使用其他名称')
    const kind = body.kind ?? existing?.kind
    if (!sourceKinds.includes(kind)) fail(400, 'INVALID_SOURCE', '请选择本地、官网或中转站')
    if (existing && kind !== existing.kind)
      fail(400, 'INVALID_SOURCE', '已有来源不能更改分类，请新建来源')
    const protocol = body.protocol ?? existing?.protocol ?? 'chat-completions'
    if (
      !['chat-completions', 'responses'].includes(protocol) ||
      (kind === 'local' && protocol !== 'chat-completions')
    )
      fail(400, 'INVALID_PROTOCOL', '服务协议无效')
    const address = baseUrl(
      body.baseUrl ??
        existing?.base_url ??
        (kind === 'official'
          ? 'https://api.deepseek.com/v1'
          : kind === 'local'
            ? config.ollamaBaseUrl || 'http://localhost:11434/v1'
            : '')
    )
    if (/\/(chat\/completions|responses|models)\/?$/.test(address))
      fail(400, 'INVALID_URL', '请填写基础地址，不包含 models 或 chat/completions')
    let keyId = body.keyId === undefined ? existing?.key_id || null : body.keyId || null
    if (kind === 'local') keyId = null
    if (body.apiKey) {
      if (kind === 'local') fail(400, 'INVALID_KEY', '本地 Ollama 无需 Key')
      const value = text(body.apiKey, 'API Key', 4096)
      const key = {
        id: id(),
        name: name + ' 服务 Key',
        secret: vault.encrypt(value),
        suffix: value.slice(-4),
        active: true,
        health: 'unknown',
        created_at: now(),
      }
      state.keys.push(key)
      keyId = key.id
    }
    if (keyId && !state.keys.some((k) => k.id === keyId && k.active))
      fail(400, 'INVALID_KEY', '请选择启用的 Key')
    for (const field of ['active', 'autoSync'])
      if (body[field] !== undefined && typeof body[field] !== 'boolean')
        fail(400, 'INVALID_FIELD', '开关必须为布尔值')
    const source = {
      ...existing,
      id: existing?.id || id(),
      name,
      kind,
      base_url: address,
      key_id: keyId,
      protocol,
      active: body.active ?? existing?.active ?? true,
      auto_sync: body.autoSync ?? existing?.auto_sync ?? true,
      revision: (existing?.revision || 0) + 1,
      created_at: existing?.created_at || now(),
    }
    const protocolChanged = existing && existing.protocol !== protocol
    const changed =
      existing && ['base_url', 'key_id', 'protocol'].some((key) => existing[key] !== source[key])
    if (existing) Object.assign(existing, source)
    else sourcesFor(state).push(source)
    for (const model of state.models.filter((m) => m.source_id === source.id)) {
      model.base_url = address
      model.key_id = keyId
      if (protocolChanged) model.protocol = protocol
      if (changed) model.verification = null
    }
    audit(state, actor, existing ? 'source.update' : 'source.create', source.id)
    return source
  }
  async function synchronize(sourceId, actor = { id: null, username: 'system' }) {
    if (pending.has(sourceId)) return pending.get(sourceId)
    const operation = (async () => {
      const snapshot = db.read(),
        source = structuredClone(find(snapshot, sourceId))
      if (!source.active) fail(409, 'SOURCE_DISABLED', '请先启用服务来源')
      const key =
        source.kind === 'local'
          ? null
          : snapshot.keys.find((k) => k.id === source.key_id && k.active)
      try {
        if (source.kind !== 'local' && !key) fail(400, 'INVALID_KEY', '请为服务来源配置 Key')
        const response = await fetch(source.base_url + '/models', {
          redirect: 'error',
          headers: key ? { Authorization: 'Bearer ' + vault.decrypt(key.secret) } : {},
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 12000)),
        })
        if (!response.ok) {
          await response.body?.cancel()
          fail(502, 'CATALOG_FAILED', '模型列表读取失败，HTTP ' + response.status)
        }
        let size = 0
        const chunks = []
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 4 * 1024 * 1024) fail(502, 'CATALOG_TOO_LARGE', '模型列表超过限制')
          chunks.push(chunk)
        }
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          fail(502, 'INVALID_CATALOG', '模型列表格式无效')
        }
        if (!Array.isArray(body.data) || !body.data.length)
          fail(502, 'EMPTY_CATALOG', '上游没有返回可用模型，保留原列表')
        const catalog = [
          ...new Map(
            body.data
              .filter(
                (m) =>
                  m && typeof m.id === 'string' && m.id.length <= 120 && !/[\x00-\x1f]/.test(m.id)
              )
              .map((m) => [
                m.id,
                {
                  id: m.id,
                  ...catalogDisplayFields(m),
                  ...(Array.isArray(m.supported_endpoint_types)
                    ? {
                        supported_endpoint_types: m.supported_endpoint_types
                          .filter((value) => typeof value === 'string')
                          .slice(0, 30),
                      }
                    : {}),
                },
              ])
          ).values(),
        ]
        if (catalog.length > 2000)
          fail(502, 'CATALOG_TOO_LARGE', '模型数量超过 2000 个，请缩小上游列表；保留原列表')
        if (!catalog.length) fail(502, 'INVALID_CATALOG', '未找到有效模型')
        return db.transaction((state) => {
          const current = find(state, sourceId),
            currentKey = key && state.keys.find((k) => k.id === key.id)
          if (
            current.revision !== source.revision ||
            !current.active ||
            (key && (!currentKey?.active || currentKey.secret !== key.secret))
          )
            fail(409, 'SOURCE_CHANGED', '来源或 Key 已更改，请重新同步')
          const all = new Set(catalog.map((model) => model.id))
          for (const model of state.models.filter((model) => model.source_id === sourceId))
            model.catalog_available = all.has(model.upstream_model)
          current.catalog = catalog.map((model) => ({
            ...model,
            unavailable_reason: catalogModelIssue(model, current.kind),
          }))
          current.catalog_revision = id()
          current.catalog_source_revision = current.revision
          current.catalog_key_fingerprint = key
            ? createHash('sha256').update(key.secret).digest('hex')
            : null
          current.synced_at = now()
          current.sync_status = 'ok'
          current.sync_error = null
          audit(state, actor, 'source.sync', sourceId)
          return {
            source: current,
            addedCandidates: 0,
            note: '已读取候选列表，请选择需要导入的模型；已有配置保持不变',
          }
        })
      } catch (error) {
        db.transaction((state) => {
          const current = sourcesFor(state).find((s) => s.id === sourceId)
          if (current?.revision === source.revision) {
            current.sync_status = 'failed'
            current.sync_error = '同步失败，请检查地址、Key 和网络；保留上次模型列表'
          }
        })
        if (error.status) throw error
        fail(502, 'SOURCE_UNAVAILABLE', '同步失败，请检查地址、Key 和网络；保留上次模型列表')
      }
    })()
    pending.set(sourceId, operation)
    try {
      return await operation
    } finally {
      pending.delete(sourceId)
    }
  }
  app.get('/admin/models/sources', (_req, res) => res.json(sourcesFor(db.read())))
  app.post('/admin/models/sources', async (req, res) => {
    const source = db.transaction((state) => saveSource(state, req.body || {}, req.user))
    if (source.auto_sync && source.active && (source.key_id || source.kind === 'local')) {
      try {
        await synchronize(source.id, req.user)
      } catch {}
    }
    res.status(201).json(find(db.read(), source.id))
  })
  app.put('/admin/models/sources/:id', (req, res) =>
    res.json(
      db.transaction((state) =>
        saveSource(state, req.body || {}, req.user, find(state, req.params.id))
      )
    )
  )
  app.delete('/admin/models/sources/:id', (req, res) => {
    db.transaction((state) => {
      find(state, req.params.id)
      if (state.models.some((m) => m.source_id === req.params.id))
        fail(409, 'SOURCE_IN_USE', '来源仍有模型，请关闭来源以保留历史配置')
      state.settings.modelSources = sourcesFor(state).filter((s) => s.id !== req.params.id)
      audit(state, req.user, 'source.delete', req.params.id)
    })
    res.json({ ok: true })
  })
  app.post('/admin/models/sources/:id/sync', async (req, res) =>
    res.json(await synchronize(req.params.id, req.user))
  )
  app.post('/admin/models/sources/:id/import', (req, res) => {
    const body = req.body || {}
    if (
      !Array.isArray(body.modelIds) ||
      !body.modelIds.length ||
      body.modelIds.length > 2000 ||
      body.modelIds.some((value) => typeof value !== 'string')
    )
      fail(400, 'INVALID_SELECTION', '请选择需要导入的模型')
    res.json(
      db.transaction((state) => {
        const sourceId = req.params.id,
          current = find(state, sourceId)
        if (!current.active) fail(409, 'SOURCE_DISABLED', '请先启用服务来源')
        const key =
          current.kind === 'local'
            ? null
            : state.keys.find((item) => item.id === current.key_id && item.active)
        if (current.kind !== 'local' && !key) fail(400, 'INVALID_KEY', '请为服务来源配置有效 Key')
        if (
          !body.catalogRevision ||
          body.catalogRevision !== current.catalog_revision ||
          current.catalog_source_revision !== current.revision ||
          current.catalog_key_fingerprint !==
            (key ? createHash('sha256').update(key.secret).digest('hex') : null)
        )
          fail(409, 'CATALOG_CHANGED', '模型列表或服务配置已更新，请关闭弹窗后重新同步')
        const ids = new Set(body.modelIds),
          selected = (current.catalog || []).filter((model) => ids.has(model.id))
        if (
          selected.length !== ids.size ||
          selected.some((model) => catalogModelIssue(model, current.kind))
        )
          fail(400, 'INVALID_SELECTION', '所选模型不存在或暂不支持，请重新选择')
        let added = 0
        for (const candidate of selected) {
          if (
            state.models.some((m) => m.source_id === sourceId && m.upstream_model === candidate.id)
          )
            continue
          const publicName =
            'qcode-' +
            sourceId.slice(0, 8) +
            '-' +
            createHash('sha256').update(candidate.id).digest('hex').slice(0, 12)
          let displayName = candidate.id
          let suffix = 2
          while (
            state.models.some(
              (model) =>
                model.name.trim().normalize('NFKC').toLowerCase() ===
                displayName.normalize('NFKC').toLowerCase()
            )
          ) {
            displayName = candidate.id + ' (' + suffix++ + ')'
          }
          const model = saveModel(state, {
            name: displayName,
            publicName,
            pricingKnown: false,
            upstreamModel: candidate.id,
            baseUrl: current.base_url,
            keyId: current.key_id,
            provider: current.kind === 'local' ? 'ollama' : family(candidate.id) || 'custom',
            protocol:
              candidate.supported_endpoint_types?.some((value) =>
                ['openai-response', 'responses'].includes(String(value).toLowerCase())
              ) &&
              !candidate.supported_endpoint_types?.some((value) =>
                ['openai', 'chat-completions'].includes(String(value).toLowerCase())
              )
                ? 'responses'
                : current.protocol,
            maxOutputTokens: current.kind === 'local' ? 256 : 8192,
            contextWindow: current.kind === 'local' ? 32768 : 131072,
            active: false,
          })
          Object.assign(model, catalogDisplayFields(candidate))
          model.source_id = sourceId
          model.catalog_available = true
          model.recommended = true
          model.discovered = true
          added++
        }

        audit(state, req.user, 'source.import', sourceId)
        return { added, skipped: selected.length - added }
      })
    )
  })
  app.post('/admin/models/sources/:id/models', (req, res) =>
    res.status(201).json(
      db.transaction((state) => {
        const source = find(state, req.params.id),
          body = req.body || {},
          upstream = text(body.upstreamModel, '上游模型', 120)
        if (state.models.some((m) => m.source_id === source.id && m.upstream_model === upstream))
          fail(409, 'MODEL_EXISTS', '此来源已经添加该模型')
        const model = saveModel(state, {
          ...body,
          pricingKnown: body.pricingKnown ?? false,
          name: body.name || upstream,
          publicName: body.publicName || 'qcode-' + id().slice(0, 24),
          baseUrl: source.base_url,
          keyId: source.key_id,
          protocol: body.protocol || source.protocol,
          provider: source.kind === 'local' ? 'ollama' : family(upstream) || 'custom',
          maxOutputTokens: body.maxOutputTokens ?? (source.kind === 'local' ? 256 : 8192),
          contextWindow: body.contextWindow ?? (source.kind === 'local' ? 32768 : 131072),
          active: body.active ?? false,
        })
        model.source_id = source.id
        model.catalog_available = true
        audit(state, req.user, 'model.create', model.id)
        return model
      })
    )
  )
  app.patch('/admin/models/sources/:id/models/:modelId', (req, res) =>
    res.json(
      db.transaction((state) => {
        const source = find(state, req.params.id),
          model = state.models.find((m) => m.id === req.params.modelId && m.source_id === source.id)
        if (!model) fail(404, 'MODEL_NOT_FOUND', '模型不存在')
        const body = req.body || {}
        const result = saveModel(
          state,
          {
            ...modelBody(model),
            ...body,
            baseUrl: source.base_url,
            keyId: source.key_id,
            provider: model.provider,
            upstreamModel: model.upstream_model,
            publicName: model.public_name,
          },
          model
        )
        audit(state, req.user, 'model.update', model.id)
        return result
      })
    )
  )
  return {
    async refreshAll() {
      for (const source of sourcesFor(db.read()).filter((s) => s.active && s.auto_sync)) {
        try {
          await synchronize(source.id)
        } catch {
          console.warn('[Model sources] 模型同步失败，继续使用已有配置')
        }
      }
    },
  }
}

export function backupBeforeModelSources(db, vault, config) {
  const state = db.read()
  if (
    db.kind !== 'sqlite-wal' ||
    !config.dbPath ||
    !state.models.length ||
    state.settings.modelSources !== undefined
  )
    return null
  const filename = path.join(
    path.dirname(path.resolve(config.dbPath)),
    'before-model-sources-' + id() + '.qcode-backup'
  )
  const snapshot = { format: 'qcode-backup-v3', createdAt: now(), state: db.export() }
  fs.writeFileSync(
    filename,
    JSON.stringify({
      format: 'qcode-encrypted-backup-v1',
      ciphertext: vault.encrypt(JSON.stringify(snapshot)),
    }),
    { flag: 'wx', mode: 0o600 }
  )
  return filename
}
