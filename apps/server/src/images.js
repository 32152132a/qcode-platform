import { sourceKey, sourceKeyIds, fetchWithKeys, suspendKey } from './key-pool.js';
import { subscriptionFor } from './entitlements.js';
import { now, id, text, integer, fail, audit, consumption, period, availableModels } from './domain.js';
import { effectiveQuotas, checkQuota } from './policy.js';
import { settingsFor } from './enterprise.js';
import { sourcesFor } from './model-sources.js';

const defaults = { enabled: false, sourceId: '', model: '', modelId: '', dailyImagesPerUser: 10, visionModelId: '' };
const settings = state => ({ ...defaults, ...state.settings.imageGeneration });
function configuredSource(state, value) {
  const source = sourcesFor(state).find(item => item.id === value.sourceId && item.active);
  const key = source && sourceKey(state, source);
  const model = value.modelId && state.models.find(item => item.id === value.modelId && item.source_id === value.sourceId && item.upstream_model === value.model);
  if (!source || (source.kind !== 'local' && !key) || (value.modelId && (!model?.active || model.catalog_available === false))) fail(503, 'IMAGE_SERVICE_UNAVAILABLE', '生图服务未配置或已停用，请联系管理员');
  return { source, key };
}
export async function readImageResponse(response) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) fail(502, 'IMAGE_TOO_LARGE', '生图结果超过大小限制');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(502, 'INVALID_IMAGE_RESPONSE', '生图服务返回格式无效'); }
  const encoded = data?.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    fail(502, 'INVALID_IMAGE_RESPONSE', '生图服务未返回 Base64 图片；当前仅支持 PNG，不下载上游临时链接');
  const image = Buffer.from(encoded, 'base64');
  if (image.length > 20 * 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    fail(502, 'INVALID_IMAGE_RESPONSE', '生图服务未返回有效 PNG 图片');
  return { data: [{ b64_json: encoded }], created: Math.floor(Date.now() / 1000) };
}
export function registerImages(app, { db, vault, config, auth, activeRequests, queueRequest }) {
  app.post('/admin/models/:id/purpose', (req, res) => res.json(db.transaction(state => {
    const model = state.models.find(item => item.id === req.params.id);
    if (!model) fail(404, 'MODEL_NOT_FOUND', '模型不存在');
    const purpose = req.body?.purpose;
    if (!['image_generation', 'vision', 'none'].includes(purpose)) fail(400, 'INVALID_PURPOSE', '请选择生图或识图用途');
    const value = settings(state);
    if (purpose === 'none') {
      if (value.visionModelId === model.id) value.visionModelId = '';
      if (value.sourceId === model.source_id && value.model === model.upstream_model) Object.assign(value, {enabled: false, modelId: '', sourceId: '', model: ''});
    } else {
      const source = sourcesFor(state).find(item => item.id === model.source_id);
      if (!source?.active || model.catalog_available === false) fail(409, 'MODEL_UNAVAILABLE', '请先启用服务来源，并确认模型未下架');
      if (source.kind !== 'local' && !state.keys.some(item => item.id === source.key_id && item.active)) fail(400, 'INVALID_KEY', '请先配置有效的服务 Key');
      if (purpose === 'vision') {
        if (model.model_type === 'image') fail(400, 'INVALID_VISION_MODEL', '生图模型不能用作识图对话模型');
        value.visionModelId = model.id;
        model.capabilities = [...new Set([...(model.capabilities || ['chat']), 'vision'])];
      } else {
        if (req.body.dailyImagesPerUser !== undefined) {
          value.dailyImagesPerUser = integer(req.body.dailyImagesPerUser, '每日生图上限', 1000);
          if (!value.dailyImagesPerUser) fail(400, 'INVALID_FIELD', '每日生图上限至少为 1');
        }
        Object.assign(value, {enabled: true, sourceId: source.id, model: model.upstream_model, modelId: model.id});
        if (value.visionModelId === model.id) value.visionModelId = '';
        model.model_type = 'image'; model.capabilities = ['image_generation']; model.is_default = false;
        for (const item of state.users) if (item.model_id === model.id) item.model_id = null;
      }
      model.active = true;
    }
    state.settings.imageGeneration = value;
    audit(state, req.user, 'model.purpose.update', model.id);
    return value;
  })));
  app.post('/admin/models/images/settings/detail', (_req, res) => res.json(settings(db.read())));
  app.post('/admin/models/images/settings/update', (req, res) => res.json(db.transaction(state => {
    const body = req.body || {}, current = settings(state);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') fail(400, 'INVALID_FIELD', '无效的图片配置');
    const value = { sourceId: body.sourceId || '', model: body.model === undefined || body.model === '' ? '' : text(body.model, '生图模型', 120), dailyImagesPerUser: integer(body.dailyImagesPerUser ?? current.dailyImagesPerUser, '每日生图上限', 1000), visionModelId: body.visionModelId ?? current.visionModelId };
    if (typeof value.visionModelId !== 'string') fail(400, 'INVALID_FIELD', '请选择默认识图模型');
    if (value.visionModelId && !availableModels(state).some(model => model.id === value.visionModelId)) fail(400, 'INVALID_VISION_MODEL', '默认识图模型不存在或已停用，请重新选择');
    if (body.enabled === undefined && Boolean(value.sourceId) !== Boolean(value.model)) fail(400, 'INVALID_FIELD', '生图站点和模型需一起填写，或一起清空');
    value.enabled = body.enabled ?? Boolean(value.sourceId && value.model);
    if (!value.dailyImagesPerUser) fail(400, 'INVALID_FIELD', '每日生图上限至少为 1');
    if (typeof value.sourceId !== 'string') fail(400, 'INVALID_FIELD', '请选择服务站点');
    if (value.enabled) { value.model = text(value.model, '生图模型', 120); configuredSource(state, value); }
    state.settings.imageGeneration = value; audit(state, req.user, 'images.settings.update', 'images'); return value;
  })));
  app.post('/client/images/status', auth, (_req, res) => {
    const state = db.read(), value = settings(state); let enabled = false;
    if (value.enabled) { try { configuredSource(state, value); enabled = true; } catch {} }
    res.json({ enabled });
  });
  app.post('/v1/images/generations', (req, res) => queueRequest(req, res, async () => {
    auth(req, res, () => {});

    const prompt = text(req.body?.prompt, '图片描述', 4000);
    if (req.body.n !== undefined && req.body.n !== 1) fail(400, 'INVALID_N', '每次只能生成一张图片');
    const started = Date.now(), startedAt = now(), requestId = id();
    let selected;
    db.transaction(state => {
      const subscription = subscriptionFor(state, req.user);
      if (subscription && subscription.expires_at <= now()) fail(403, 'SUBSCRIPTION_EXPIRED', '套餐已到期，请申请重新开通或联系管理员');
      const value = settings(state);
      if (!value.enabled) fail(503, 'IMAGE_GENERATION_DISABLED', '管理员尚未启用生图服务');
      const { source, key } = configuredSource(state, value), user = state.users.find(item => item.id === req.user.id);
      if (state.requests.filter(item => item.status === 'pending').length >= settingsFor(state).maxActiveRequests) fail(429, 'GATEWAY_BUSY', '网关繁忙，请稍后重试');
      const used = state.requests.filter(item => item.user_id === user.id && item.purpose === 'image_generation' && ['pending','success'].includes(item.status) && period(item.started_at, config.timezone) === period(startedAt, config.timezone)).length;
      if (used >= value.dailyImagesPerUser) fail(429, 'IMAGE_QUOTA_EXCEEDED', '今日生图张数已达上限');
      checkQuota(effectiveQuotas(state, user), consumption(state, user, config.timezone, startedAt), 0, '用户 ');
      selected = { model: value.model, source: structuredClone(source), key: structuredClone(key) };
      state.requests.push({ id: requestId, subscription_id: subscription?.id || null, user_id: user.id, username: user.username, model: value.model, model_id: value.modelId || null, key_id: key?.id || null, started_at: startedAt, status: 'pending', purpose: 'image_generation', reserved_tokens: 0, charged_tokens: 0, total_tokens: null, input_tokens: null, output_tokens: null });
    });
    const controller = new AbortController(), active = { userId: req.user.id, sessionId: req.session.id, controller, reason: null };
    activeRequests.set(requestId, active);
    let status = 'failed', errorCode, upstreamStatus, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(config.timeoutMs, 120000));
    const close = () => { if (!res.writableFinished) controller.abort(); }; res.on('close', close);
    try {
      const payload = { model: selected.model, prompt, n: 1, ...(/^gpt-image-/i.test(selected.model) ? { output_format: 'png' } : { response_format: 'b64_json' }) };
      const snapshot = db.read();
      const response = await fetchWithKeys({db, keys: selected.key ? sourceKeyIds(selected.source).map(id => snapshot.keys.find(key => key.id === id)).filter(key => key?.active) : [null], signal: controller.signal,
        build: key => ({url: selected.source.base_url + '/images/generations', method: 'POST', headers: {'Content-Type': 'application/json', ...(key ? {Authorization: 'Bearer ' + vault.decrypt(key.secret)} : {})}, body: JSON.stringify(payload)}),
        attempt: key => { selected.key = key; db.transaction(state => { state.requests.find(item => item.id === requestId).key_id = key?.id || null; }); },
      });
      upstreamStatus = response.status;
      if (!response.ok) { await response.body?.cancel(); fail(response.status === 429 ? 429 : 502, 'IMAGE_UPSTREAM_ERROR', '生图服务返回 HTTP ' + response.status + '，请检查生图模型、Key 权限和余额'); }
      const result = await readImageResponse(response); status = 'success'; res.json(result);
    } catch (error) {
      errorCode = active.reason || (timedOut ? 'IMAGE_TIMEOUT' : controller.signal.aborted ? 'CLIENT_DISCONNECTED' : error.code || 'IMAGE_UNAVAILABLE');
      if (!active.reason && (!controller.signal.aborted || timedOut) && (timedOut || !error.status || error.code === 'INVALID_IMAGE_RESPONSE')) suspendKey(db, selected.key, timedOut ? '上游生图超时' : '上游生图响应异常');
      if (error.status) throw error;
      fail(502, errorCode, timedOut ? '图片生成超时，请稍后再试；未自动重发' : '图片生成失败，请检查生图服务；未自动重发');
    } finally {
      clearTimeout(timer); res.off('close', close); activeRequests.delete(requestId);
      db.transaction(state => Object.assign(state.requests.find(item => item.id === requestId), { status, error_code: errorCode || null, upstream_status: upstreamStatus ?? null, duration_ms: Date.now() - started, finished_at: now(), generated_images: status === 'success' ? 1 : 0, usage_source: 'images', cost_micros: null }));
    }
  }));
}
