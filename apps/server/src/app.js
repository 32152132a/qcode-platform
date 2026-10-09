import express from 'express';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { createDatabase, createVault, hashPassword } from './database.js';
import { now, id, fail, text, password, integer, baseUrl, quotas, publicUser, audit, resolveModel } from './domain.js';
import { complete, statistics } from './proxy.js';
import { registerAuth } from './auth.js';
import { adminPermission, rolePermissions, protectAdministrator } from './policy.js';
import { registerEnterpriseRoutes } from './enterprise.js';
import { registerDistribution } from './distribution.js';
import { registerReports, filterRecords } from './reports.js';

export function readConfig(env) {
  const number = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  createVault(env.KEY_ENCRYPTION_SECRET);
  const timezone = env.QUOTA_TIMEZONE || 'Asia/Shanghai';
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const trustedProxies=(env.TRUST_PROXY_CIDRS||'').split(',').map(s=>s.trim()).filter(Boolean);
  for(const value of trustedProxies){const [address,prefix]=value.split('/'),family=isIP(address);if(!family||(prefix!==undefined&&(!/^\d+$/.test(prefix)||Number(prefix)>(family===4?32:128))))throw new Error('Invalid TRUST_PROXY_CIDRS');}
  return { host: env.HOST || '127.0.0.1', port: number('PORT', 3100, 1, 65535),
    timeoutMs: number('REQUEST_TIMEOUT_MS', 180000, 10, 3600000),
    tokenTtlDays: number('AUTH_TOKEN_TTL_DAYS', 7, 1, 90), timezone,
    accessTokenMinutes: number('ACCESS_TOKEN_MINUTES', 30, 1, 1440), refreshTokenDays: number('REFRESH_TOKEN_DAYS', 30, 1, 365),
    loginFailureLimit: number('LOGIN_FAILURE_LIMIT', 10, 1, 100), trustedProxies,
    dbPath: env.DB_PATH || './data/qcode.sqlite', encryptionSecret: env.KEY_ENCRYPTION_SECRET,
    adminUsername: env.ADMIN_USERNAME, adminPassword: env.ADMIN_PASSWORD,
    baseUrl: env.UPSTREAM_BASE_URL ? baseUrl(env.UPSTREAM_BASE_URL) : null,
    upstreamModel: env.UPSTREAM_MODEL, publicModel: env.PUBLIC_MODEL || 'qcode-model', upstreamKey: env.UPSTREAM_API_KEY,
    adminAddresses: (env.ADMIN_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean) };
}

export function createApp(config, database) {
  const vault = createVault(config.encryptionSecret);
  const db = database || createDatabase(config.dbPath, { vault });
  const timezone = config.timezone || 'Asia/Shanghai';
  config = { timeoutMs: 180000, tokenTtlDays: 7, accessTokenMinutes: 30, refreshTokenDays: 30, loginFailureLimit: 10, adminAddresses: [], ...config, timezone };
  db.transaction(state => {
    if (!state.users.some(u => u.role === 'admin')) {
      if (!config.adminUsername || !config.adminPassword) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD to create the first administrator');
      if (config.adminPassword.startsWith('replace-with-') || config.adminPassword === 'change-this-password') throw new Error('Replace the placeholder administrator password before first startup');
      const username = text(config.adminUsername, 'username', 80);
      if (state.users.some(u => u.username === username)) throw new Error('Administrator username is already used');
      state.users.push({ id: state.nextUserId++, username, password_hash: hashPassword(password(config.adminPassword)), role: 'admin',
        is_active: 1, department: '', department_id: null, quota_mode: 'custom', max_concurrent_requests: 2,
        created_at: now(), session_limit: 2, model_id: null, key_id: null, quotas: quotas(), legacy_tokens: 0 });
    }
    if (!state.models.length && config.baseUrl && config.upstreamModel) state.models.push({ id: id(), name: 'Default model',
      public_name: config.publicModel, upstream_model: config.upstreamModel, base_url: baseUrl(config.baseUrl),
      active: true, is_default: true, max_output_tokens: 8192, context_window: 131072, max_tokens_field: 'max_tokens', input_price: 0, output_price: 0, currency: 'CNY', stream_usage: true, created_at: now() });
    if (!state.keys.length && config.upstreamKey && !config.upstreamKey.startsWith('replace-with-')) {
      const keyId = id();
      state.keys.push({ id: keyId, name: 'Initial provider key', secret: vault.encrypt(config.upstreamKey), suffix: config.upstreamKey.slice(-4), active: true, health: 'unknown', created_at: now() });
      for (const user of state.users.filter(u => u.role === 'admin')) user.key_id = keyId;
    }
  });
  const app = express();
  if(config.trustedProxies?.length)app.set('trust proxy',config.trustedProxies);
  app.locals.db = db;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'Cache-Control': 'no-store' });
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => {
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) fail(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  registerDistribution(app);
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  const activeRequests = new Map();
  const cancelRequests = (userId, reason, sessionId) => {
    for (const active of activeRequests.values()) if (active.userId === userId && (!sessionId || active.sessionId === sessionId)) {
      active.reason = reason; active.controller.abort();
    }
  };
  const auth = registerAuth(app, { db, config, cancelRequests });
  app.use('/admin', auth, adminPermission(db, config));
  registerEnterpriseRoutes(app, { db, config, auth, cancelRequests });
  registerReports(app, {db, config});
  const getUser = (state, userId) => {
    const user = state.users.find(u => u.id === Number(userId));
    if (!user) fail(404, 'USER_NOT_FOUND', 'User not found');
    return user;
  };
  const validateAssignment = (state, body) => {
    if (body.departmentId != null && !state.departments.some(d => d.id === body.departmentId && d.active)) fail(400, 'INVALID_DEPARTMENT', '请选择启用的部门');
    if (body.keyId != null && !state.keys.some(k => k.id === body.keyId && k.active)) fail(400, 'INVALID_KEY', 'Choose an enabled key');
    if (body.modelId != null && !state.models.some(m => m.id === body.modelId && m.active)) fail(400, 'INVALID_MODEL', 'Choose an enabled model');
  };
  app.get('/admin/users', (_req, res) => { const state = db.read(); res.json(state.users.map(u => publicUser(state, u, timezone))); });
  function createUser(state, body, actor) {
    const username = text(body.username, 'username', 80);
    if (!/^[\p{L}\p{N}_.@-]+$/u.test(username)) fail(400, 'INVALID_USERNAME', 'Username contains unsupported characters');
    if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase())) fail(409, 'USER_EXISTS', 'Username already exists');
    validateAssignment(state, body);
    if (body.role && (!Object.hasOwn(rolePermissions, body.role) || (actor.role !== 'admin' && body.role !== 'user'))) fail(403, 'INVALID_ROLE', '角色配置无效');
    if (body.quotaMode && !['custom','department'].includes(body.quotaMode)) fail(400, 'INVALID_QUOTA_MODE', '无效的配额模式');
    const maxConcurrent = integer(body.maxConcurrentRequests ?? 1, 'maxConcurrentRequests', 20);
    if (!maxConcurrent) fail(400, 'INVALID_FIELD', '并发请求数至少为 1');
    const user = { id: state.nextUserId++, username, password_hash: hashPassword(password(body.password)), role: body.role || 'user', is_active: 1,
      department_id: body.departmentId || null, quota_mode: body.quotaMode || 'custom', max_concurrent_requests: maxConcurrent,
      department: typeof body.department === 'string' ? body.department.slice(0, 80) : '', created_at: now(),
      model_id: body.modelId ?? null, key_id: body.keyId ?? null, session_limit: integer(body.sessionLimit ?? 1, 'sessionLimit', 20), quotas: quotas(body.quotas), legacy_tokens: 0 };
    if (!user.session_limit) fail(400, 'INVALID_FIELD', 'sessionLimit must be at least 1');
    state.users.push(user); audit(state, actor, 'user.create', user.id);
    return publicUser(state, user, timezone);
  }
  app.post('/admin/users', (req, res) => res.status(201).json(db.transaction(state => createUser(state, req.body || {}, req.user))));
  app.post('/admin/users/import', (req, res) => {
    if (!Array.isArray(req.body?.users) || !req.body.users.length || req.body.users.length > 100) fail(400, 'INVALID_IMPORT', 'Provide 1–100 users');
    res.status(201).json(db.transaction(state => req.body.users.map(body => createUser(state, body, req.user))));
  });
  app.patch('/admin/users/:id', (req, res) => res.json(db.transaction(state => {
    const user = getUser(state, req.params.id), body = req.body || {};
    validateAssignment(state, body);
    if ('role' in body) {
      if (req.user.role !== 'admin' || !Object.hasOwn(rolePermissions, body.role)) fail(403, 'INVALID_ROLE', '角色配置无效');
      protectAdministrator(state, user, req.user, body.role !== 'admin');
      if (body.role !== user.role) state.tokens = state.tokens.filter(t => t.user_id !== user.id);
      user.role = body.role;
    }
    if ('departmentId' in body) user.department_id = body.departmentId || null;
    if ('quotaMode' in body) { if (!['custom','department'].includes(body.quotaMode)) fail(400, 'INVALID_QUOTA_MODE', '无效的配额模式'); user.quota_mode = body.quotaMode; }
    if ('maxConcurrentRequests' in body) { user.max_concurrent_requests = integer(body.maxConcurrentRequests, 'maxConcurrentRequests', 20); if (!user.max_concurrent_requests) fail(400, 'INVALID_FIELD', '并发请求数至少为 1'); }
    if ('username' in body) {
      const username = text(body.username, 'username', 80);
      if (!/^[\p{L}\p{N}_.@-]+$/u.test(username)) fail(400, 'INVALID_USERNAME', 'Username contains unsupported characters');
      if (state.users.some(u => u.id !== user.id && u.username.toLowerCase() === username.toLowerCase())) fail(409, 'USER_EXISTS', 'Username already exists');
      user.username = username;
    }
    if ('department' in body) user.department = typeof body.department === 'string' ? body.department.slice(0, 80) : '';
    if ('modelId' in body) user.model_id = body.modelId;
    if ('keyId' in body) user.key_id = body.keyId;
    if ('quotas' in body) user.quotas = quotas(body.quotas);
    if ('sessionLimit' in body) {
      user.session_limit = integer(body.sessionLimit, 'sessionLimit', 20);
      if (!user.session_limit) fail(400, 'INVALID_FIELD', 'sessionLimit must be at least 1');
      state.tokens = state.tokens.filter(t => t.user_id !== user.id);
    }
    audit(state, req.user, 'user.update', user.id);
    return publicUser(state, user, timezone);
  })));
  app.patch('/admin/users/:id/status', (req, res) => {
    if (typeof req.body?.isActive !== 'boolean') fail(400, 'INVALID_FIELD', 'isActive must be boolean');
    db.transaction(state => {
      const user = getUser(state, req.params.id);
      if (user.role === 'admin') fail(400, 'ADMIN_PROTECTED', '请先将管理员调整为其他角色再停用');
      user.is_active = Number(req.body.isActive);
      state.tokens = state.tokens.filter(t => t.user_id !== user.id);
      audit(state, req.user, user.is_active ? 'user.enable' : 'user.disable', user.id);
    });
    cancelRequests(Number(req.params.id), 'USER_DISABLED');
    res.json({ ok: true });
  });
  app.post('/admin/users/:id/password', (req, res) => {
    const hashed = hashPassword(password(req.body?.password));
    db.transaction(state => {
      const user = getUser(state, req.params.id); user.password_hash = hashed;
      state.tokens = state.tokens.filter(t => t.user_id !== user.id);
      audit(state, req.user, 'user.password.reset', user.id);
    }); cancelRequests(Number(req.params.id), 'SESSION_REVOKED'); res.json({ ok: true });
  });
  app.post('/admin/users/:id/revoke-sessions', (req, res) => {
    db.transaction(state => { const user = getUser(state, req.params.id); state.tokens = state.tokens.filter(t => t.user_id !== user.id); audit(state, req.user, 'user.sessions.revoke', user.id); });
    cancelRequests(Number(req.params.id), 'SESSION_REVOKED'); res.json({ ok: true });
  });
  app.post('/admin/users/:id/reset-quota', (req, res) => {
    db.transaction(state => {
      const user = getUser(state, req.params.id);
      if (state.requests.some(r => r.user_id === user.id && r.status === 'pending')) fail(409, 'REQUEST_IN_PROGRESS', 'Wait for active requests before resetting quotas');
      user.quota_reset_at = now(); user.legacy_tokens = 0; audit(state, req.user, 'user.quota.reset', user.id);
    }); res.json({ ok: true });
  });
  app.delete('/admin/users/:id', (req, res) => {
    db.transaction(state => {
      const user = getUser(state, req.params.id);
      if (user.role === 'admin') fail(400, 'ADMIN_PROTECTED', 'Administrator cannot be deleted');
      if (state.requests.some(r => r.user_id === user.id && r.status === 'pending')) fail(409, 'REQUEST_IN_PROGRESS', 'Wait for active requests before deleting');
      state.users = state.users.filter(u => u.id !== user.id); state.tokens = state.tokens.filter(t => t.user_id !== user.id);
      audit(state, req.user, 'user.delete', user.id);
    }); res.json({ ok: true });
  });
  const publicKey = (state, key) => ({ id: key.id, name: key.name, suffix: key.suffix, active: key.active, health: key.health,
    checked_at: key.checked_at, created_at: key.created_at, assigned_users: state.users.filter(u => u.key_id === key.id).map(u => u.username),
    requests: state.requests.filter(r => r.key_id === key.id).length });
  app.get('/admin/keys', (_req, res) => { const state = db.read(); res.json(state.keys.map(k => publicKey(state, k))); });
  app.post('/admin/keys', (req, res) => {
    const entries = req.body?.keys || [req.body];
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) fail(400, 'INVALID_IMPORT', 'Provide 1–100 keys');
    res.status(201).json(db.transaction(state => entries.map(entry => {
      const secret = text(entry?.apiKey, 'apiKey', 4096);
      if (/[\r\n]/.test(secret)) fail(400, 'INVALID_KEY', 'Key cannot contain line breaks');
      if (state.keys.some(k => vault.decrypt(k.secret) === secret)) fail(409, 'KEY_EXISTS', 'This key already exists');
      const key = { id: id(), name: text(entry.name, 'name'), secret: vault.encrypt(secret), suffix: secret.slice(-4), active: true, health: 'unknown', created_at: now() };
      state.keys.push(key); audit(state, req.user, 'key.create', key.id); return publicKey(state, key);
    })));
  });
  app.patch('/admin/keys/:id', (req, res) => {
    if (!req.body) fail(400, 'INVALID_REQUEST', 'Request body is required');
    res.json(db.transaction(state => {
      const key = state.keys.find(k => k.id === req.params.id);
      if (!key) fail(404, 'KEY_NOT_FOUND', 'Key not found');
      if ('active' in req.body) { if (typeof req.body.active !== 'boolean') fail(400, 'INVALID_FIELD', 'active must be boolean'); key.active = req.body.active; }
      if ('name' in req.body) key.name = text(req.body.name, 'name');
      if ('apiKey' in req.body) {
        const secret = text(req.body.apiKey, 'apiKey', 4096);
        if (/[\r\n]/.test(secret)) fail(400, 'INVALID_KEY', 'Key cannot contain line breaks');
        if (state.keys.some(k => k.id !== key.id && vault.decrypt(k.secret) === secret)) fail(409, 'KEY_EXISTS', 'This key already exists');
        key.secret = vault.encrypt(secret); key.suffix = secret.slice(-4); key.health = 'unknown';
      }
      audit(state, req.user, 'key.update', key.id); return publicKey(state, key);
    }));
  });
  app.delete('/admin/keys/:id', (req, res) => {
    db.transaction(state => {
      if (!state.keys.some(k => k.id === req.params.id)) fail(404, 'KEY_NOT_FOUND', 'Key not found');
      if (state.users.some(u => u.key_id === req.params.id) || state.departments.some(d => d.key_id === req.params.id) || state.requests.some(r => r.key_id === req.params.id && r.status === 'pending')) fail(409, 'KEY_IN_USE', '请先回收用户和部门的 Key，并等待进行中的请求完成');
      state.keys = state.keys.filter(k => k.id !== req.params.id); audit(state, req.user, 'key.delete', req.params.id);
    }); res.json({ ok: true });
  });
  app.post('/admin/keys/:id/check', async (req, res) => {
    const state = db.read(), key = state.keys.find(k => k.id === req.params.id);
    const model = state.models.find(m => req.body?.modelId ? m.id === req.body.modelId : m.is_default);
    if (!key || !model) fail(400, 'INVALID_CHECK', 'Choose a key and model');
    let health = 'unreachable';
    try {
      const response = await fetch(`${model.base_url}/models`, { headers: { Authorization: `Bearer ${vault.decrypt(key.secret)}` }, redirect: 'error', signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10000)) });
      health = response.ok ? 'reachable' : [401, 403].includes(response.status) ? 'rejected' : `http_${response.status}`;
      await response.body?.cancel();
    } catch { /* Health is returned without disclosing provider response or address. */ }
    db.transaction(next => {
      const saved = next.keys.find(k => k.id === key.id);
      if (saved && saved.secret === key.secret) { saved.health = health; saved.checked_at = now(); }
      audit(next, req.user, 'key.check', key.id);
    }); res.json({ health, note: 'Checks /models only; generation and billing permissions require a real request.' });
  });
  app.get('/admin/models', (_req, res) => res.json(db.read().models));
  function saveModel(state, body, existing) {
    for (const price of [body.inputPrice ?? 0, body.outputPrice ?? 0]) if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 100000) fail(400, 'INVALID_PRICE', '单价必须在 0 到 100000 之间');
    if (!['CNY','USD'].includes(body.currency || 'CNY')) fail(400, 'INVALID_CURRENCY', '币种只支持 CNY 或 USD');
    if (!['max_tokens','max_completion_tokens'].includes(body.maxTokensField || 'max_tokens')) fail(400, 'INVALID_FIELD', '无效的输出上限字段');
    const model = { ...existing, id: existing?.id || id(), name: text(body.name, 'name'), public_name: text(body.publicName, 'publicName', 80),
      upstream_model: text(body.upstreamModel, 'upstreamModel'), base_url: baseUrl(body.baseUrl),
      max_output_tokens: integer(body.maxOutputTokens ?? 8192, 'maxOutputTokens', 131072),
      context_window: integer(body.contextWindow ?? 131072, 'contextWindow', 2000000), input_price: body.inputPrice ?? 0, output_price: body.outputPrice ?? 0, currency: body.currency || 'CNY', max_tokens_field: body.maxTokensField || 'max_tokens',
      stream_usage: body.streamUsage !== false, active: body.active !== false, is_default: body.isDefault === true, created_at: existing?.created_at || now() };
    if (!/^[a-zA-Z0-9_.-]+$/.test(model.public_name) || !model.max_output_tokens || model.context_window < model.max_output_tokens) fail(400, 'INVALID_MODEL', '公开模型名称或上下文/输出上限配置无效');
    if (state.models.some(m => m.id !== model.id && m.public_name === model.public_name)) fail(409, 'MODEL_EXISTS', 'Public model name already exists');
    if (model.is_default) for (const m of state.models) m.is_default = false;
    if (existing) Object.assign(existing, model); else state.models.push(model);
    return model;
  }
  app.post('/admin/models', (req, res) => res.status(201).json(db.transaction(state => {
    const model = saveModel(state, req.body || {}); audit(state, req.user, 'model.create', model.id); return model;
  })));
  app.put('/admin/models/:id', (req, res) => res.json(db.transaction(state => {
    const existing = state.models.find(m => m.id === req.params.id);
    if (!existing) fail(404, 'MODEL_NOT_FOUND', 'Model not found');
    const model = saveModel(state, req.body || {}, existing); audit(state, req.user, 'model.update', model.id); return model;
  })));
  app.get('/admin/usage', (req, res) => {const state=db.read();state.requests=filterRecords(state.requests,req.query,timezone);res.json(statistics(state, timezone));});
  const page = (items, query) => {
    const offset = integer(Number(query.offset || 0), 'offset'), limit = integer(Number(query.limit || 50), 'limit', 200);
    return { total: items.length, items: items.slice().reverse().slice(offset, offset + limit) };
  };
  app.get('/admin/requests', (req, res) => res.json(page(filterRecords(db.read().requests,req.query,timezone), req.query)));
  app.get('/admin/audits', (req, res) => res.json(page(filterRecords(db.read().audits,req.query,timezone), req.query)));
  app.get('/admin/system', (_req, res) => res.json({ version: '0.3.0', storage: db.kind, timezone,
    tokenTtlDays: config.tokenTtlDays, requestTimeoutMs: config.timeoutMs, uptimeSeconds: Math.floor(process.uptime()),
    pendingRequests: db.read().requests.filter(r => r.status === 'pending').length }));
  app.use('/v1', auth);
  app.get('/v1/models', (req, res) => {
    const model = resolveModel(db.read(), req.user);
    res.json({ object: 'list', data: model?.active ? [{ id: model.public_name, object: 'model', created: 0, owned_by: 'qcode' }] : [] });
  });
  app.post('/v1/chat/completions', (req, res) => complete(req, res, { db, vault, config, activeRequests }));
  app.use((_req, _res) => fail(404, 'NOT_FOUND', 'Endpoint not found'));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.destroy();
    const status = error.status || 500;
    res.status(status).json({ error: { type: 'gateway_error', code: error.code || (status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'),
      message: error.status && error.code ? error.message : status === 400 ? 'Invalid JSON request' : 'Gateway could not complete the request' } });
  });
  return app;
}
