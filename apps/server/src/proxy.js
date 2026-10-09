import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { now, id, fail, resolveModel, consumption, period, integer } from './domain.js';
import { effectiveKey, effectiveQuotas, departmentFor, departmentConsumption, checkQuota } from './policy.js';
import { settingsFor } from './enterprise.js';

function parseUsage(value) {
  if (!value || !Number.isSafeInteger(value.total_tokens) || value.total_tokens < 0) return null;
  const input = Number.isSafeInteger(value.prompt_tokens) && value.prompt_tokens >= 0 ? value.prompt_tokens : null;
  const output = Number.isSafeInteger(value.completion_tokens) && value.completion_tokens >= 0 ? value.completion_tokens : null;
  return { input_tokens: input, output_tokens: output, total_tokens: Math.max(value.total_tokens, (input || 0) + (output || 0)) };
}

export async function complete(req, res, { db, vault, config, activeRequests = new Map() }) {
  const body = req.body;
  const state = db.read(), model = resolveModel(state, req.user), key = effectiveKey(state, req.user), department = departmentFor(state, req.user);
  if (department && !department.active) fail(403, 'DEPARTMENT_DISABLED', '所在部门已被停用');
  if (!model?.active) fail(503, 'MODEL_UNAVAILABLE', 'No enabled model assigned');
  if (!key?.active) fail(503, 'KEY_UNAVAILABLE', 'No enabled key assigned');
  if (body?.model !== model.public_name) fail(400, 'INVALID_MODEL', 'Select your assigned model from /v1/models');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => !m || typeof m !== 'object')) fail(400, 'INVALID_MESSAGES', 'messages must be a non-empty array');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') fail(400, 'INVALID_STREAM', 'stream must be boolean');
  if (body.n !== undefined && body.n !== 1) fail(400, 'INVALID_N', 'Only one completion per request is supported');
  const outputLimit = body.max_completion_tokens ?? body.max_tokens ?? model.max_output_tokens;
  integer(outputLimit, 'max_tokens', model.max_output_tokens);
  if (!outputLimit) fail(400, 'INVALID_FIELD', 'Output token limit must be positive');
  // UTF-8 bytes plus message/tool overhead is a conservative estimate, not a provider tokenizer.
  const reserved = Buffer.byteLength(JSON.stringify(body), 'utf8') + body.messages.length * 32 + outputLimit;
  const requestId = id(), startedAt = now(), started = Date.now();
  db.transaction(next => {
    const user = next.users.find(u => u.id === req.user.id), used = consumption(next, user, config.timezone, startedAt);
    if (next.requests.filter(r => r.status === 'pending').length >= settingsFor(next).maxActiveRequests) fail(429, 'GATEWAY_BUSY', '网关当前繁忙，请稍后重试');
    if (next.requests.filter(r => r.user_id === user.id && r.status === 'pending').length >= (user.max_concurrent_requests || 1)) fail(429, 'REQUEST_IN_PROGRESS', '账号同时请求数量已达到上限');
    checkQuota(effectiveQuotas(next, user), used, reserved, '用户 ');
    if (department) checkQuota(department.quotas, departmentConsumption(next, department, config.timezone, startedAt), reserved, '部门 ');
    next.requests.push({ id: requestId, user_id: user.id, username: user.username, model: model.public_name, model_id: model.id,
      department_id: department?.id || null, department_name: department?.name || '', key_id: key.id, started_at: startedAt, status: 'pending', reserved_tokens: reserved, input_tokens: null, output_tokens: null, total_tokens: null });
  });
  const controller = new AbortController();
  const active = { userId: req.user.id, sessionId: req.session.id, controller, reason: null };
  activeRequests.set(requestId, active);
  let timedOut = false, disconnected = false, usage = null, status = 'failed', errorCode = null, upstreamStatus = null;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  const onClose = () => { if (!res.writableFinished) { disconnected = true; controller.abort(); } };
  res.on('close', onClose);
  const forward = { ...body, model: model.upstream_model, n: 1 };
  delete forward.max_tokens; delete forward.max_completion_tokens;
  forward[model.max_tokens_field || 'max_tokens'] = outputLimit;
  if (body.stream && model.stream_usage) forward.stream_options = { ...(body.stream_options || {}), include_usage: true };
  try {
    const response = await fetch(`${model.base_url}/chat/completions`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vault.decrypt(key.secret)}` },
      body: JSON.stringify(forward), signal: controller.signal });
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
      await pipeline(Readable.fromWeb(response.body), observer, res);
    } else {
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 16 * 1024 * 1024) { controller.abort(); fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Model response too large'); }
        chunks.push(chunk);
      }
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid model JSON response'); }
      if (!Array.isArray(result.choices) || result.error) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Model response is missing choices');
      usage = parseUsage(result.usage);
      result.model = model.public_name;
      res.json(result);
    }
    status = 'success';
  } catch (error) {
    status = disconnected || active.reason ? 'cancelled' : 'failed';
    errorCode = active.reason || (timedOut ? 'UPSTREAM_TIMEOUT' : disconnected ? 'CLIENT_DISCONNECTED' : error.code || 'UPSTREAM_UNAVAILABLE');
    if (!res.headersSent && !res.destroyed) res.status(timedOut ? 504 : error.status || 502).json({ error: { type: 'gateway_error', code: errorCode,
      message: timedOut ? 'Model request timed out' : error.status ? error.message : 'Unable to complete model request' } });
    else if (!res.writableFinished) res.destroy();
  } finally {
    clearTimeout(timeout); res.off('close', onClose);
    activeRequests.delete(requestId);
    db.transaction(next => {
      const record = next.requests.find(r => r.id === requestId);
      // Unknown consumption stays reserved, including disconnects; never silently bill it as zero.
      Object.assign(record, { ...usage, status, error_code: errorCode, upstream_status: upstreamStatus,
        duration_ms: Date.now() - started, finished_at: now(), usage_source: usage ? 'provider' : 'reservation',
        charged_tokens: usage?.total_tokens ?? reserved });
      const cost = usage?.input_tokens != null && usage?.output_tokens != null ? Math.round(usage.input_tokens * (model.input_price || 0) + usage.output_tokens * (model.output_price || 0)) : null;
      record.cost_micros = Number.isSafeInteger(cost) ? cost : null;
      record.currency = model.currency || 'CNY';
      record.input_price = model.input_price || 0; record.output_price = model.output_price || 0;
      const saved = next.keys.find(k => k.id === key.id);
      if (saved && saved.secret === key.secret) {
        if ([401, 403].includes(upstreamStatus)) saved.health = 'rejected';
        else if (status === 'success') saved.health = 'working';
      }
    });
  }
}

export function statistics(state, timezone) {
  const totals = { requests: 0, success: 0, failed: 0, pending: 0, tokens: 0, chargedTokens: 0, unknownUsage: 0, costs: {}, unknownCost: 0 };
  const users = new Map(), days = new Map(), departments = new Map();
  for (const r of state.requests) {
    totals.requests++; totals.tokens += r.total_tokens || 0; totals.chargedTokens += r.charged_tokens ?? r.reserved_tokens;
    if (r.status === 'success') totals.success++; else if (r.status === 'pending') totals.pending++; else totals.failed++;
    if (r.total_tokens === null) totals.unknownUsage++;
    if (r.cost_micros == null) totals.unknownCost++;
    else totals.costs[r.currency || 'CNY'] = (totals.costs[r.currency || 'CNY'] || 0) + r.cost_micros / 1000000;
    const day = period(r.started_at, timezone);
    for (const [map, key, initial] of [[users, r.user_id, { userId: r.user_id, username: r.username }], [days, day, { date: day }], [departments, r.department_id || '', { departmentId: r.department_id, name: r.department_name || '未分组' }]]) {
      const row = map.get(key) || { ...initial, requests: 0, tokens: 0, chargedTokens: 0, costs: {} };
      if (r.cost_micros != null) row.costs[r.currency || 'CNY'] = (row.costs[r.currency || 'CNY'] || 0) + r.cost_micros / 1000000;
      row.requests++; row.tokens += r.total_tokens || 0; row.chargedTokens += r.charged_tokens ?? r.reserved_tokens; map.set(key, row);
    }
  }
  return { totals, users: [...users.values()].sort((a, b) => b.chargedTokens - a.chargedTokens), departments: [...departments.values()].sort((a,b) => b.chargedTokens - a.chargedTokens), days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)), timezone };
}
