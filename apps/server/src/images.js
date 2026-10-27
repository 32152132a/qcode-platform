import { now, id, text, integer, fail, audit, consumption, period } from './domain.js';
import { effectiveQuotas, checkQuota, departmentFor, departmentConsumption } from './policy.js';
import { settingsFor } from './enterprise.js';
import { sourcesFor } from './model-sources.js';

const defaults = { enabled: false, sourceId: '', model: '', dailyImagesPerUser: 10 };
const settings = state => ({ ...defaults, ...state.settings.imageGeneration });
function configuredSource(state, value) {
  const source = sourcesFor(state).find(item => item.id === value.sourceId && item.active);
  const key = source && state.keys.find(item => item.id === source.key_id && item.active);
  if (!source || source.kind === 'local' || !key) fail(503, 'IMAGE_SERVICE_UNAVAILABLE', '生图服务未配置或已停用，请联系管理员');
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
  app.post('/admin/models/images/settings/detail', (_req, res) => res.json(settings(db.read())));
  app.post('/admin/models/images/settings/update', (req, res) => res.json(db.transaction(state => {
    const body = req.body || {}, current = settings(state);
    if (typeof body.enabled !== 'boolean') fail(400, 'INVALID_FIELD', '生图开关必须为布尔值');
    const value = { enabled: body.enabled, sourceId: body.sourceId || '', model: body.model === undefined || body.model === '' ? '' : text(body.model, '生图模型', 120), dailyImagesPerUser: integer(body.dailyImagesPerUser ?? current.dailyImagesPerUser, '每日生图上限', 1000) };
    if (!value.dailyImagesPerUser) fail(400, 'INVALID_FIELD', '每日生图上限至少为 1');
    if (typeof value.sourceId !== 'string') fail(400, 'INVALID_FIELD', '请选择服务站点');
    if (value.enabled) { value.model = text(value.model, '生图模型', 120); configuredSource(state, value); }
    state.settings.imageGeneration = value; audit(state, req.user, 'images.settings.update', 'images'); return value;
  })));
  app.post('/client/images/status', auth, (_req, res) => {
    const state = db.read(), value = settings(state); let enabled = false;
    if (value.enabled) { try { configuredSource(state, value); enabled = true; } catch {} }
    res.json({ enabled, model: enabled ? value.model : null });
  });
  app.post('/v1/images/generations', (req, res) => queueRequest(req, res, async () => {
    auth(req, res, () => {});
    const prompt = text(req.body?.prompt, '图片描述', 4000);
    if (req.body.n !== undefined && req.body.n !== 1) fail(400, 'INVALID_N', '每次只能生成一张图片');
    const started = Date.now(), startedAt = now(), requestId = id();
    let selected;
    db.transaction(state => {
      const value = settings(state);
      if (!value.enabled) fail(503, 'IMAGE_GENERATION_DISABLED', '管理员尚未启用生图服务');
      const { source, key } = configuredSource(state, value), user = state.users.find(item => item.id === req.user.id), department = departmentFor(state, user);
      if (department && !department.active) fail(403, 'DEPARTMENT_DISABLED', '所在部门已停用');
      if (state.requests.filter(item => item.status === 'pending').length >= settingsFor(state).maxActiveRequests) fail(429, 'GATEWAY_BUSY', '网关繁忙，请稍后重试');
      const used = state.requests.filter(item => item.user_id === user.id && item.purpose === 'image_generation' && ['pending','success'].includes(item.status) && period(item.started_at, config.timezone) === period(startedAt, config.timezone)).length;
      if (used >= value.dailyImagesPerUser) fail(429, 'IMAGE_QUOTA_EXCEEDED', '今日生图张数已达上限');
      checkQuota(effectiveQuotas(state, user), consumption(state, user, config.timezone, startedAt), 0, '用户 ');
      if (department) checkQuota(department.quotas, departmentConsumption(state, department, config.timezone, startedAt), 0, '部门 ');
      selected = { model: value.model, source: structuredClone(source), key: structuredClone(key) };
      state.requests.push({ id: requestId, user_id: user.id, username: user.username, model: value.model, model_id: null, key_id: key.id, department_id: department?.id || null, department_name: department?.name || '', started_at: startedAt, status: 'pending', purpose: 'image_generation', reserved_tokens: 0, charged_tokens: 0, total_tokens: null, input_tokens: null, output_tokens: null });
    });
    const controller = new AbortController(), active = { userId: req.user.id, sessionId: req.session.id, controller, reason: null };
    activeRequests.set(requestId, active);
    let status = 'failed', errorCode, upstreamStatus, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(config.timeoutMs, 120000));
    const close = () => { if (!res.writableFinished) controller.abort(); }; res.on('close', close);
    try {
      const payload = { model: selected.model, prompt, n: 1, ...(/^gpt-image-/i.test(selected.model) ? { output_format: 'png' } : { response_format: 'b64_json' }) };
      const response = await fetch(selected.source.base_url + '/images/generations', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + vault.decrypt(selected.key.secret) }, body: JSON.stringify(payload), signal: controller.signal });
      upstreamStatus = response.status;
      if (!response.ok) { await response.body?.cancel(); fail(response.status === 429 ? 429 : 502, 'IMAGE_UPSTREAM_ERROR', '生图服务返回 HTTP ' + response.status + '，请检查生图模型、Key 权限和余额'); }
      const result = await readImageResponse(response); status = 'success'; res.json(result);
    } catch (error) {
      errorCode = active.reason || (timedOut ? 'IMAGE_TIMEOUT' : controller.signal.aborted ? 'CLIENT_DISCONNECTED' : error.code || 'IMAGE_UNAVAILABLE');
      if (error.status) throw error;
      fail(502, errorCode, timedOut ? '图片生成超时，请稍后再试；未自动重发' : '图片生成失败，请检查生图服务；未自动重发');
    } finally {
      clearTimeout(timer); res.off('close', close); activeRequests.delete(requestId);
      db.transaction(state => Object.assign(state.requests.find(item => item.id === requestId), { status, error_code: errorCode || null, upstream_status: upstreamStatus ?? null, duration_ms: Date.now() - started, finished_at: now(), generated_images: status === 'success' ? 1 : 0, usage_source: 'images', cost_micros: null }));
    }
  }));
}
