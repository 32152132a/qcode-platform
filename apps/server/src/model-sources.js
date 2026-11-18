import { bindSourceKeys, sourceKey, sourceKeyIds, fetchWithKeys } from './key-pool.js';
import { officialPrice, modelPrice } from './billing.js';
import { catalogDisplayFields } from './model-presentation.js'
import { id, now, text, baseUrl, fail, audit, availableModels } from './domain.js'

export function configuredVisionModel(state) {
  return availableModels(state).find(model => model.id === state.settings.imageGeneration?.visionModelId);
}
export const sourceKinds = ['local', 'official', 'relay']
export const sourcesFor = (state) => state.settings.modelSources || []
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
  const image = catalogDisplayFields(model).capabilities?.includes('image_generation')
  if (catalogDisplayFields(model).capabilities?.includes('embedding') || /(embedding|rerank|video|audio|tts|whisper)/i.test(model.id))
    return '暂不支持该类模型'
  if (
    !image && kind !== 'local' &&
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
export function modelReference(source, candidate) {
  const official = officialPrice(source, candidate.id)
  const price = { ...official, ...candidate.catalog_price }
  const knownContext = official?.contextWindow
  return {
    contextWindow: candidate.context_window ?? knownContext,
    contextSource: candidate.context_window ? '上游目录' : knownContext ? '官网参考' : undefined,
    ...Object.fromEntries(Object.entries(price).filter(([field]) =>
      ['inputPrice', 'cachedInputPrice', 'outputPrice', 'imagePrice'].includes(field))),
    priceSource: candidate.catalog_price ? (official ? '上游目录与官网参考' : '上游目录') : official ? '官网参考' : undefined,
  }
}

function catalogContext(model) {
  const value = model.context_window ?? model.context_length ?? model.model_info?.context_window
  return Number.isSafeInteger(value) && value > 0 && value <= 2000000 ? value : undefined
}

function bailianPrice(model) {
  const tiers = model.prices
  if (!Array.isArray(tiers) || tiers.length !== 1 || !/^(default|默认)$/i.test(tiers[0]?.range_name || '')) return undefined
  const fields = { input_token: 'inputPrice', output_token: 'outputPrice', cache_read_token: 'cachedInputPrice', cached_input_token: 'cachedInputPrice', image_number: 'imagePrice' }
  const entries = (Array.isArray(tiers[0].prices) ? tiers[0].prices : []).flatMap(item => {
    const field = fields[item.type]
    const unit = field === 'imagePrice' ? /^(元\/(张|幅)|每张|per image)$/i : /^(元\/(百万|100万)\s*tokens?|每百万\s*tokens?|per million tokens)$/i
    const value = typeof item.price === 'number' || (typeof item.price === 'string' && item.price.trim()) ? Number(item.price) : NaN
    return field && unit.test(item.price_unit) && Number.isFinite(value) && value >= 0 && value <= 100000
      ? [[field, value]] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function modelFormBody(body) {
  const settings = { ...body }
  if (typeof settings.contextWindow === 'string' && /^[0-9]+$/.test(settings.contextWindow))
    settings.contextWindow = Number(settings.contextWindow)
  for (const field of ['inputPrice', 'cachedInputPrice', 'outputPrice', 'imagePrice']) {
    const value = settings[field]
    if (value == null) continue
    if (value === '') {
      delete settings[field]
      continue
    }
    settings[field] = modelPrice(value)
  }
  return settings
}

function confirmedSettings(body, image) {
  if (!image && (!Number.isSafeInteger(body.contextWindow) || body.contextWindow < 1))
    fail(400, 'MODEL_CONTEXT_REQUIRED', '请填写上下文长度')
  const fields = image ? ['imagePrice'] : ['inputPrice', 'cachedInputPrice', 'outputPrice']
  if (fields.some(field => typeof body[field] !== 'string'))
    fail(400, 'MODEL_PRICE_REQUIRED', '请填写人民币单价，免费项目请填 0')
  return { ...body, currency: 'CNY', pricingKnown: true }
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
    contextWindow: model.context_window,
    inputPrice: model.input_price,
    cachedInputPrice: model.cached_input_price,
    imagePrice: model.image_price,
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
    const workspace = body.catalogWorkspaceId ?? existing?.catalog_workspace_id ?? ''
    if (workspace && (kind !== 'official' || new URL(address).hostname !== 'dashscope.aliyuncs.com' ||
      typeof workspace !== 'string' || !/^ws_[a-zA-Z0-9_-]{1,80}$/.test(workspace)))
      fail(400, 'INVALID_CATALOG_WORKSPACE', '请填写有效的百炼北京工作空间 ID')
    let keyId = body.keyId === undefined ? existing?.key_id || null : body.keyId || null
    if (kind === 'local') keyId = null
    if (body.apiKey) {
      if (kind === 'local') fail(400, 'INVALID_KEY', '本地 Ollama 无需 Key')
      const value = text(body.apiKey, 'API Key', 4096)
      if (state.keys.some(key => vault.decrypt(key.secret) === value)) fail(409, 'KEY_EXISTS', '此 Key 已存在，请从 Key 池选择')
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
    if (keyId && !state.keys.some((k) => k.id === keyId))
      fail(400, 'INVALID_KEY', '请选择存在的 Key')
    if (body.active !== undefined && typeof body.active !== 'boolean')
      fail(400, 'INVALID_FIELD', '启用状态必须为布尔值')
    const source = {
      ...existing,
      id: existing?.id || id(),
      name,
      kind,
      base_url: address,
      catalog_workspace_id: workspace,
      key_id: keyId,
      protocol,
      active: body.active ?? existing?.active ?? true,
      revision: (existing?.revision || 0) + 1,
      created_at: existing?.created_at || now(),
    }
    bindSourceKeys(state, source, body.keyIds ?? (body.apiKey || body.keyId !== undefined ? [keyId].filter(Boolean) : sourceKeyIds(source)));
    const protocolChanged = existing && existing.protocol !== protocol
    const changed =
      existing && (['base_url', 'key_id', 'protocol'].some((key) => existing[key] !== source[key]) || JSON.stringify(existing.fallback_key_ids) !== JSON.stringify(source.fallback_key_ids))
    if (existing) Object.assign(existing, source)
    else sourcesFor(state).push(source)
    for (const model of state.models.filter((m) => m.source_id === source.id)) {
      model.base_url = address
      model.key_id = source.key_id
      if (protocolChanged) model.protocol = protocol
      if (changed) model.verification = null
    }
    audit(state, actor, existing ? 'source.update' : 'source.create', source.id)
    return source
  }
  async function synchronize(sourceId) {
    if (pending.has(sourceId)) return pending.get(sourceId)
    const operation = (async () => {

      const snapshot = db.read(),
        source = structuredClone(find(snapshot, sourceId))
      if (!source.active) fail(409, 'SOURCE_DISABLED', '请先启用服务来源')
      let key =
        source.kind === 'local'
          ? null
          : sourceKey(snapshot, source)
      try {
        if (source.kind !== 'local' && !key) fail(400, 'INVALID_KEY', '请为服务来源配置 Key')
        const workspace = source.catalog_workspace_id
        const signal = AbortSignal.timeout(Math.min(config.timeoutMs, 12000))
        async function readPage(url) {
          const response = await fetchWithKeys({db, keys: key ? sourceKeyIds(source).map(id => snapshot.keys.find(item => item.id === id)).filter(item => item?.active) : [null],
            signal,
            build: candidate => ({url, headers: candidate ? {Authorization: 'Bearer ' + vault.decrypt(candidate.secret)} : {}}),
            attempt: candidate => { key = candidate },
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
          try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            fail(502, 'INVALID_CATALOG', '模型列表格式无效')
          }
        }
        let rows
        if (workspace) {
          rows = []
          for (let page = 1; page <= 20; page++) {
            const url = 'https://' + workspace + '.cn-beijing.maas.aliyuncs.com/api/v1/models?language=zh-CN&service_site=asia-pacific-china&page_size=100&page_no=' + page
            const { output, success } = await readPage(url)
            if (success !== true || !Array.isArray(output?.models) || !Number.isSafeInteger(output.total))
              fail(502, 'INVALID_CATALOG', '百炼模型列表格式无效')
            rows.push(...output.models.map(model => ({
              ...model, id: model.model, catalog_price: bailianPrice(model),
              capabilities: (Array.isArray(model.capabilities) ? model.capabilities : []).flatMap(value =>
                ({ TG: ['chat'], Reasoning: ['thinking'], VU: ['vision'], IG: ['image_generation'], TR: ['embedding'], ME: ['embedding'] })[value] || []),
            })))
            if (rows.length >= output.total) break
            if (!output.models.length || page === 20) fail(502, 'INCOMPLETE_CATALOG', '百炼目录未完整返回，保留原列表')
          }
        } else {
          rows = (await readPage(source.base_url + '/models')).data
        }
        if (!Array.isArray(rows) || !rows.length)
          fail(502, 'EMPTY_CATALOG', '上游没有返回可用模型，保留原列表')
        const catalog = [
          ...new Map(
            rows
              .filter(
                (m) =>
                  m && typeof m.id === 'string' && m.id.length <= 120 && !/[\x00-\x1f]/.test(m.id)
              )
              .map((m) => [
                m.id,
                {
                  id: m.id,
                  context_window: catalogContext(m),
                  ...(workspace ? { catalog_price: m.catalog_price } : {}),
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
          for (const model of state.models.filter((model) => model.source_id === sourceId)) {
            if (all.has(model.upstream_model)) model.catalog_available = true
            else if (!workspace) model.catalog_available = false
          }
          current.catalog = catalog.map((model) => ({
            ...model,
            reference: modelReference(current, model),
            unavailable_reason: catalogModelIssue(model, current.kind),
          }))
          current.synced_at = now()
          current.sync_status = 'ok'
          current.sync_error = null
          return {
            source: current,
            note: '已读取上游目录',
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
  app.post('/admin/models/sources/list', (_req, res) => res.json(sourcesFor(db.read())))
  app.post('/admin/models/sources/create', async (req, res) => {
    const source = db.transaction((state) => saveSource(state, req.body || {}, req.user))
    if (source.active && (source.key_id || source.kind === 'local')) {
      try {
        await synchronize(source.id)
      } catch {}
    }
    res.status(201).json(find(db.read(), source.id))
  })
  app.post('/admin/models/sources/:id/update', (req, res) =>
    res.json(
      db.transaction((state) =>
        saveSource(state, req.body || {}, req.user, find(state, req.params.id))
      )
    )
  )
  app.post('/admin/models/sources/:id/delete', (req, res) => {
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
    res.json(await synchronize(req.params.id))
  )
  app.post('/admin/models/sources/:id/models', (req, res) =>
    res.status(201).json(
      db.transaction((state) => {
        const source = find(state, req.params.id),
          body = modelFormBody(req.body || {}),
          upstream = text(body.upstreamModel, '上游模型', 120)
        if (state.models.some((m) => m.source_id === source.id && m.upstream_model === upstream))
          fail(409, 'MODEL_EXISTS', '此来源已经添加该模型')
        const candidate = source.catalog?.find(item => item.id === upstream) || { id: upstream }
        const issue = catalogModelIssue(candidate, source.kind)
        if (issue) fail(400, 'INVALID_SELECTION', issue)
        const names = new Set(state.models.map(model => model.name.trim().normalize('NFKC').toLowerCase()))
        let displayName = upstream
        for (let suffix = 2; !body.name && names.has(displayName.normalize('NFKC').toLowerCase()); suffix++)
          displayName = upstream + ' (' + suffix + ')'
        const image = catalogDisplayFields(candidate).capabilities?.includes('image_generation')
        const model = saveModel(state, {
          ...confirmedSettings(body, image),
          name: body.name || displayName,
          publicName: body.publicName || 'qcode-' + id().slice(0, 24),
          baseUrl: source.base_url,
          keyId: source.key_id,
          protocol: body.protocol || source.protocol,
          provider: source.kind === 'local' ? 'ollama' : family(upstream) || 'custom',
          active: body.active ?? false,
          isDefault: !image && body.isDefault === true,
        })
        Object.assign(model, catalogDisplayFields(candidate))
        if (body.supportsVision !== undefined) {
          const capabilities = (model.capabilities || []).filter(value => value !== 'vision')
          model.capabilities = body.supportsVision ? [...capabilities, 'vision'] : capabilities
        }
        model.model_type = model.capabilities?.includes('image_generation') ? 'image' : 'chat'
        model.source_id = source.id
        model.catalog_available = true
        audit(state, req.user, 'model.create', model.id)
        return model
      })
    )
  )
  app.post('/admin/models/sources/:id/models/:modelId/delete', (req, res) => {
    db.transaction((state) => {
      const source = find(state, req.params.id),
        model = state.models.find((m) => m.id === req.params.modelId && m.source_id === source.id)
      if (!model) fail(404, 'MODEL_NOT_FOUND', '模型不存在')
      const images = state.settings.imageGeneration
      if (images?.visionModelId === model.id) images.visionModelId = ''
      if (images && images.sourceId === model.source_id && images.model === model.upstream_model) {
        Object.assign(images, { enabled: false, modelId: '', sourceId: '', model: '' })
      }
      state.models = state.models.filter((m) => m.id !== model.id)
      // Request records retain their model identity for usage and quota accounting.
      audit(state, req.user, 'model.delete', model.id)
    })
    res.json({ ok: true })
  })
  app.post('/admin/models/sources/:id/models/:modelId/update', (req, res) =>
    res.json(
      db.transaction((state) => {
        const source = find(state, req.params.id),
          model = state.models.find((m) => m.id === req.params.modelId && m.source_id === source.id)
        if (!model) fail(404, 'MODEL_NOT_FOUND', '模型不存在')
        const body = modelFormBody(req.body || {})
        const priceFields = ['inputPrice', 'cachedInputPrice', 'outputPrice', 'imagePrice']
        const editingPrice = priceFields.some(field => Object.hasOwn(body, field))
        const settings = { ...modelBody(model), ...body }
        if (editingPrice || body.pricingKnown === true)
          Object.assign(settings, confirmedSettings({
            ...body,
            contextWindow: body.contextWindow ?? (model.pricing_known ? model.context_window : undefined),
          }, model.model_type === 'image'))
        if (settings.active && (!settings.pricingKnown || settings.currency !== 'CNY'))
          fail(400, 'MODEL_PRICE_REQUIRED', '请先配置模型的上下文和人民币单价，再启用模型')
        const result = saveModel(
          state,
          {
            ...settings,
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
      const state = db.read()
      for (const source of sourcesFor(state).filter((s) => s.active && (s.kind === 'local' || sourceKey(state, s)))) {
        try {
          await synchronize(source.id)
        } catch {
          console.warn('[Model sources] 模型同步失败，继续使用已有配置')
        }
      }
    },
  }
}
