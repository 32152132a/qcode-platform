import { sourceKeyIds, fetchWithKeys, suspendKey } from './key-pool.js';
import { subscriptionFor } from './entitlements.js';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { now, id, fail, availableModels, consumption, period, integer } from './domain.js';
import { effectiveKey, effectiveQuotas, checkQuota } from './policy.js';
import { settingsFor } from './enterprise.js';
import { providerRequest, chatResponse, responseStream } from './providers.js';
import { configuredVisionModel } from './model-sources.js';

function parseUsage(value) {
  if (!value || !Number.isSafeInteger(value.total_tokens) || value.total_tokens < 0) return null;
  const input = Number.isSafeInteger(value.prompt_tokens) && value.prompt_tokens >= 0 ? value.prompt_tokens : null;
  const output = Number.isSafeInteger(value.completion_tokens) && value.completion_tokens >= 0 ? value.completion_tokens : null;
  return { input_tokens: input, output_tokens: output, total_tokens: Math.max(value.total_tokens, (input || 0) + (output || 0)) };
}

export async function complete(req, res, { db, vault, config, activeRequests = new Map() }) {

  const body = req.body;
  const state = db.read(), models = availableModels(state, req.user), selectedModel = models.find(item => item.public_name === body?.model);
  const subscription = subscriptionFor(state, req.user);
  if (subscription && subscription.expires_at <= now()) fail(403, 'SUBSCRIPTION_EXPIRED', '套餐已到期，请申请重新开通或联系管理员');
  if (subscription && !selectedModel && availableModels(state).some(item => item.public_name === body?.model)) fail(403, 'PLAN_MODEL_NOT_ALLOWED', '当前套餐不包含此模型，请刷新权益后重新选择');
  if (subscription && !models.length && availableModels(state).length) fail(403, 'PLAN_MODEL_NOT_ALLOWED', '当前套餐暂无可用对话模型，请联系管理员');
  let model = selectedModel;
  if (!models.length) fail(503, 'MODEL_UNAVAILABLE', '后台尚未启用模型，请联系管理员');
  if (!model) fail(400, 'INVALID_MODEL', '请选择 /v1/models 中已启用的模型');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => !m || typeof m !== 'object')) fail(400, 'INVALID_MESSAGES', 'messages must be a non-empty array');
  const hasImages = body.messages.some(message => Array.isArray(message.content) && message.content.some(part => part?.type === 'image_url'));
  if (hasImages && !model.capabilities?.includes('vision')) {
    model = configuredVisionModel(state);
    if (!model) fail(503, 'VISION_UNAVAILABLE', '当前模型不支持图片识别，请联系管理员在“模型与服务”中配置默认识图模型；文字对话仍可使用');
  }
  let key = model.provider === 'ollama' ? null : effectiveKey(state, req.user, model);
  if (model.provider !== 'ollama' && !key?.active) fail(503, 'KEY_UNAVAILABLE', '模型服务暂不可用，请联系管理员');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') fail(400, 'INVALID_STREAM', 'stream must be boolean');
  if (body.n !== undefined && body.n !== 1) fail(400, 'INVALID_N', 'Only one completion per request is supported');
  const requestedOutput = body.max_completion_tokens ?? body.max_tokens ?? model.max_output_tokens;
  const outputLimit = hasImages && Number.isSafeInteger(requestedOutput) ? Math.min(requestedOutput, model.max_output_tokens) : requestedOutput;
  integer(outputLimit, 'max_tokens', model.max_output_tokens);
  if (!outputLimit) fail(400, 'INVALID_FIELD', 'Output token limit must be positive');
  // UTF-8 bytes plus message/tool overhead is a conservative estimate, not a provider tokenizer.
  const reserved = Buffer.byteLength(JSON.stringify(body), 'utf8') + body.messages.length * 32 + outputLimit;
  const outbound = providerRequest(body, model, key ? vault.decrypt(key.secret) : undefined, outputLimit);
  const payload = JSON.stringify(outbound.payload);
  const source = state.settings.modelSources.find(source => source.id === model.source_id);
  const keys = key && source ? sourceKeyIds(source).map(id => state.keys.find(item => item.id === id)).filter(item => item?.active) : [key];
  const requestId = id(), startedAt = now(), started = Date.now();
  db.transaction(next => {
    const user = next.users.find(u => u.id === req.user.id), used = consumption(next, user, config.timezone, startedAt);
    if (next.requests.filter(r => r.status === 'pending').length >= settingsFor(next).maxActiveRequests) fail(429, 'GATEWAY_BUSY', '网关当前繁忙，请稍后重试');
    if (next.requests.filter(r => r.user_id === user.id && r.status === 'pending').length >= 1) fail(429, 'REQUEST_IN_PROGRESS', '账号同时请求数量已达到上限');
    checkQuota(effectiveQuotas(next, user), used, reserved, '用户 ');
    next.requests.push({ id: requestId, subscription_id: subscription?.id || null, user_id: user.id, username: user.username, model: model.public_name, model_id: model.id, purpose: hasImages ? 'image_understanding' : 'chat',
      key_id: key?.id || null, started_at: startedAt, status: 'pending', reserved_tokens: reserved, input_tokens: null, output_tokens: null, total_tokens: null });
  });
  const controller = new AbortController();
  const active = { userId: req.user.id, sessionId: req.session.id, controller, reason: null };
  activeRequests.set(requestId, active);
  let timedOut = false, disconnected = false, usage = null, status = 'failed', errorCode = null, upstreamStatus = null;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  const onClose = () => { if (!res.writableFinished) { disconnected = true; controller.abort(); } };
  res.on('close', onClose);
  try {
    const response = await fetchWithKeys({ db, keys, signal: controller.signal,
      build: candidate => ({url: outbound.url, method: 'POST', body: payload,
        headers: {...outbound.headers, ...(candidate ? {Authorization: 'Bearer ' + vault.decrypt(candidate.secret)} : {})},
      }),
      attempt: candidate => {
        key = candidate;
        db.transaction(next => {
          const record = next.requests.find(item => item.id === requestId);
          record.key_id = key?.id || null;
          (record.key_attempts ||= []).push({ key_id: key?.id || null, started_at: now() });
        });
      },
    });
    upstreamStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      fail(response.status === 429 ? 429 : 502, 'UPSTREAM_ERROR', `Model provider returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!response.body || !contentType.includes(body.stream ? 'text/event-stream' : 'application/json')) {
      await response.body?.cancel(); fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Unexpected model provider response');
    }
    if (body.stream) {
      let buffer = '', done = false;
      const decoder = new TextDecoder();
      const consume = () => {
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data === '[DONE]') { done = true; continue; }
          if (!data) continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid stream event'); }
          if (parsed.error) fail(502, 'UPSTREAM_STREAM_ERROR', 'Model provider reported a stream error');
          usage = parseUsage(parsed.usage) || usage;
        }
        if (buffer.length > 1024 * 1024) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Stream event too large');
      };
      let trailingCR = false;
      const observer = new Transform({
        transform(chunk, _encoding, callback) {
          try {
            let decoded = (trailingCR ? '\r' : '') + decoder.decode(chunk, { stream: true });
            trailingCR = decoded.endsWith('\r');
            if (trailingCR) decoded = decoded.slice(0, -1);
            buffer += decoded.replace(/\r\n/g, '\n'); consume(); callback(null, chunk);
          } catch (error) { callback(error); }
        },
        flush(callback) {
          try { buffer += decoder.decode(); consume(); if (!done) fail(502, 'INCOMPLETE_STREAM', 'Stream ended before completion'); callback(); }
          catch (error) { callback(error); }
        },
      });
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' });
      const source = model.protocol === 'responses' ? Readable.from(responseStream(response.body, model)) : Readable.fromWeb(response.body);
      await pipeline(source, observer, res);
    } else {
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 16 * 1024 * 1024) { controller.abort(); fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Model response too large'); }
        chunks.push(chunk);
      }
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid model JSON response'); }
      result = chatResponse(result, model);
      if (!Array.isArray(result.choices) || result.error) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Model response is missing choices');
      usage = parseUsage(result.usage);
      result.model = selectedModel.public_name;
      res.json(result);
    }
    status = 'success';
  } catch (error) {
    const upstreamFailure = ['INVALID_UPSTREAM_RESPONSE','UPSTREAM_STREAM_ERROR','INCOMPLETE_STREAM'].includes(error.code);
    status = active.reason || (disconnected && !upstreamFailure) ? 'cancelled' : 'failed';
    if (status === 'failed' && (timedOut || upstreamFailure)) suspendKey(db, key, timedOut ? '上游请求超时' : '上游响应异常');
    errorCode = active.reason || (timedOut ? 'UPSTREAM_TIMEOUT' : upstreamFailure ? error.code : disconnected ? 'CLIENT_DISCONNECTED' : error.code || 'UPSTREAM_UNAVAILABLE');
    if (!res.headersSent && !res.destroyed) res.status(timedOut ? 504 : error.status || 502).json({ error: { type: 'gateway_error', code: errorCode,
      message: timedOut ? 'Model request timed out' : error.status ? error.message : 'Unable to complete model request' } });
    else if (!res.writableFinished) res.destroy();
  } finally {
    clearTimeout(timeout); res.off('close', onClose);
    activeRequests.delete(requestId);
    db.transaction(next => {
      const record = next.requests.find(r => r.id === requestId);
      // Release the reservation even when upstream usage is unavailable.
      Object.assign(record, { ...usage, status, error_code: errorCode, upstream_status: upstreamStatus,
        duration_ms: Date.now() - started, finished_at: now(), usage_source: usage ? 'provider' : 'unknown',
        charged_tokens: usage?.total_tokens ?? 0 });
      const cost = model.pricing_known !== false && usage?.input_tokens != null && usage?.output_tokens != null ? Math.round(usage.input_tokens * (model.input_price || 0) + usage.output_tokens * (model.output_price || 0)) : null;
      record.cost_micros = Number.isSafeInteger(cost) ? cost : null;
      record.currency = model.currency || 'CNY';
      record.input_price = model.input_price || 0; record.output_price = model.output_price || 0;
      const saved = key && next.keys.find(k => k.id === key.id);
      if (saved && saved.secret === key.secret) {
        if ([401, 403].includes(upstreamStatus)) saved.health = 'rejected';
        else if (status === 'success') saved.health = 'working';
      }
    });
  }
}

export function statistics(state, timezone) {
  const empty = () => ({ requests: 0, success: 0, failed: 0, pending: 0, tokens: 0, inputTokens: 0, outputTokens: 0, unknownUsage: 0, costs: {}, unknownCost: 0 });
  const totals = empty(), users = new Map(), days = new Map(), models = new Map();
  function add(target, row) {
    target.requests++;
    target.tokens += row.total_tokens ?? 0;
    target.inputTokens += row.input_tokens ?? 0;
    target.outputTokens += row.output_tokens ?? 0;
    if (row.status === 'success') target.success++;
    else if (row.status === 'pending') target.pending++;
    else target.failed++;
    if (row.total_tokens == null && row.status !== 'pending') target.unknownUsage++;
    if (row.cost_micros == null) target.unknownCost++;
    else target.costs[row.currency || 'CNY'] = (target.costs[row.currency || 'CNY'] || 0) + row.cost_micros / 1000000;
  }
  for (const row of state.requests) {
    add(totals, row);
    for (const [map, key, identity] of [
      [users, row.user_id, { userId: row.user_id, username: row.username }],
      [days, period(row.started_at, timezone), { date: period(row.started_at, timezone) }],
      [models, row.model_id ?? row.model ?? '', { modelId: row.model_id, name: row.model || '未知模型' }],
    ]) {
      if (!map.has(key)) map.set(key, { ...identity, ...empty() });
      add(map.get(key), row);
    }
  }
  const ranked = map => [...map.values()].sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);
  return { totals, users: ranked(users), models: ranked(models), days: [...days.values()].sort((a,b) => b.date.localeCompare(a.date)), timezone };
}
