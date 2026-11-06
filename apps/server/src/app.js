import { registerEmbeddingSettings } from './embeddings.js';
import { keySource, sourceKeyIds, bindSourceKeys } from './key-pool.js';
import { registerPlans, assignUserPlan } from './plans.js';
import { registerFeedback } from './feedback.js';
import { registerImages } from './images.js';
import { businessOperation, obsoleteBusinessRequest } from '../../client/api-contract.mjs';
import { createAccountRequestQueue } from './request-queue.js';
import { registerWebPages } from './web-pages.js';
import {registerModelSources,sourcesFor} from './model-sources.js';
import { registerKnowledge } from './knowledge.js';
import { protocols } from './providers.js';
import { registerModelChecks } from './model-checks.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { createDatabase, createVault, hashPassword } from './database.js';
import { now, id, fail, text, password, integer, baseUrl, quotas, publicUser, audit, availableModels, resolveModel } from './domain.js';
import { complete, statistics, deletedModelId } from './proxy.js';
import { registerAuth, ensureDemoUser } from './auth.js';
import { adminPermission } from './policy.js';
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
    timezone,
    accessTokenMinutes: number('ACCESS_TOKEN_MINUTES', 30, 1, 1440), refreshTokenDays: number('REFRESH_TOKEN_DAYS', 30, 1, 365),
    loginFailureLimit: number('LOGIN_FAILURE_LIMIT', 10, 1, 100), trustedProxies,
    dbPath: env.DB_PATH || './data/qcode.sqlite', encryptionSecret: env.KEY_ENCRYPTION_SECRET,
    adminUsername: env.ADMIN_USERNAME, adminPassword: env.ADMIN_PASSWORD,
    demoEnabled: env.DEMO_ENABLED === 'true', demoUsername: env.DEMO_USERNAME || 'demo', demoPassword: env.DEMO_PASSWORD || 'qcode-demo-2026',
    ollamaBaseUrl: env.OLLAMA_BASE_URL ? baseUrl(env.OLLAMA_BASE_URL) : null,
    baseUrl: env.UPSTREAM_BASE_URL ? baseUrl(env.UPSTREAM_BASE_URL) : null,
    upstreamModel: env.UPSTREAM_MODEL, publicModel: env.PUBLIC_MODEL || 'qcode-model', upstreamKey: env.UPSTREAM_API_KEY,
    adminAddresses: (env.ADMIN_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean) };
}

export function createApp(config, database) {
  const vault = createVault(config.encryptionSecret);
  const db = database || createDatabase(config.dbPath, { vault });
  const timezone = config.timezone || 'Asia/Shanghai';
  config = { demoEnabled: false, demoUsername: 'demo', demoPassword: 'qcode-demo-2026', timeoutMs: 180000, accessTokenMinutes: 30, refreshTokenDays: 30, loginFailureLimit: 10, adminAddresses: [], ...config, timezone };
  db.transaction(state => {
    if (!state.users.some(u => u.role === 'admin')) {
      if (!config.adminUsername || !config.adminPassword) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD to create the first administrator');
      if (config.adminPassword.startsWith('replace-with-') || config.adminPassword === 'change-this-password') throw new Error('Replace the placeholder administrator password before first startup');
      const username = text(config.adminUsername, 'username', 80);
      if (state.users.some(u => u.username === username)) throw new Error('Administrator username is already used');
      state.users.push({ id: state.nextUserId++, username, password_hash: hashPassword(password(config.adminPassword)), role: 'admin',
        is_active: 1,
        created_at: now(), session_limit: 2, key_id: null, quotas: quotas() });
    }
    if (!state.keys.length && config.upstreamKey && !config.upstreamKey.startsWith('replace-with-')) {
      const keyId = id();
      state.keys.push({ id: keyId, name: 'Initial provider key', secret: vault.encrypt(config.upstreamKey), suffix: config.upstreamKey.slice(-4), active: true, health: 'unknown', created_at: now() });
      for (const user of state.users.filter(u => u.role === 'admin')) user.key_id = keyId;
    }
    function provisionModel(body, kind, name) {
      const model = saveModel(state, body);
      const source = { id: id(), kind, name, base_url: model.base_url, key_id: model.key_id,
        protocol: model.protocol, active: true, auto_sync: !!model.key_id || kind === 'local', created_at: now(), revision: 1 };
      state.settings.modelSources.push(source);
      model.source_id = source.id;
      return model;
    }
    if (!state.models.length && config.baseUrl && config.upstreamModel) {
      const official = /^https:\/\/api\.deepseek\.com(?:\/|$)/.test(config.baseUrl);
      provisionModel({ name: 'Default model', publicName: config.publicModel || 'qcode-model', upstreamModel: config.upstreamModel,
        baseUrl: config.baseUrl, keyId: state.keys[0]?.id || null, isDefault: true }, official ? 'official' : 'relay', official ? 'DeepSeek 官方' : '中转服务');
    }
    if (config.ollamaBaseUrl && !state.settings.ollamaModelProvisioned) {
      if (!state.models.some(model => model.public_name === 'qcode-qwen-local')) {
        const model = provisionModel({name:'通义千问 Qwen 0.5B（本地测试）',provider:'ollama',protocol:'chat-completions',publicName:'qcode-qwen-local',upstreamModel:'qwen:0.5b',baseUrl:config.ollamaBaseUrl,maxOutputTokens:256,contextWindow:32768,active:true,isDefault:false}, 'local', '本地 Ollama');
        audit(state,{id:null,username:'system'},'model.provision',model.id);
      }
      state.settings.ollamaModelProvisioned = true;
    }
  });
  ensureDemoUser(db, config);
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
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) fail(400, 'INVALID_REQUEST', '请求内容必须为 JSON 对象');
    next();
  });
  app.use((req, _res, next) => {
    if (req.method === 'POST') {
      req.businessOperation = businessOperation(req.path);
      if (req.businessOperation?.[3] === 'read') Object.defineProperty(req, 'query', { value: req.body || {}, configurable: true });
    }
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  registerDistribution(app);
  registerWebPages(app);
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  const activeRequests = new Map();
  const cancelRequests = (userId, reason, sessionId) => {
    for (const active of activeRequests.values()) if (active.userId === userId && (!sessionId || active.sessionId === sessionId)) {
      active.reason = reason; active.controller.abort();
    }
  };
  const auth = registerAuth(app, { db, config, cancelRequests });
  app.use('/admin', auth, adminPermission(config));
  registerEnterpriseRoutes(app, { db, config, auth, cancelRequests });
  registerKnowledge(app, { db, auth });
  registerFeedback(app, { db, auth, config });
  registerPlans(app, { db, auth, config });
  registerReports(app, {db, config});
  const getUser = (state, userId) => {
    const user = state.users.find(u => u.id === Number(userId));
    if (!user) fail(404, 'USER_NOT_FOUND', '用户不存在');
    return user;
  };
  const validateAssignment = (state, body) => {
    if (body.keyId != null && !state.keys.some(k => k.id === body.keyId && k.active)) fail(400, 'INVALID_KEY', '请选择已启用的 Key');
  };
  app.post('/admin/users/options', (_req, res) => {
    const state=db.read();res.json({plans:state.plans.filter(plan=>plan.active).map(plan=>({id:plan.id,name:plan.name}))});
  });
  app.post('/admin/users/list', (_req, res) => { const state = db.read(); res.json(state.users.map(u => publicUser(state, u, timezone))); });
  function createUser(state, body, actor) {
    const username = text(body.username, 'username', 80);
    if (!/^[\p{L}\p{N}_.@-]+$/u.test(username)) fail(400, 'INVALID_USERNAME', '账号仅支持中文、字母、数字、下划线、点、@ 和短横线');
    if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase())) fail(409, 'USER_EXISTS', '账号已存在');
    validateAssignment(state, body);
    if (body.role !== undefined && body.role !== 'user') fail(403, 'INVALID_ROLE', '只能创建普通用户，管理员和演示账号由系统配置');
    const user = { id: state.nextUserId++, username, password_hash: hashPassword(password(body.password)), role: 'user', is_active: 1,
      created_at: now(),
      key_id: body.keyId ?? null, session_limit: integer(body.sessionLimit ?? 1, 'sessionLimit', 20), quotas: quotas(body.quotas) };
    if (!user.session_limit) fail(400, 'INVALID_FIELD', '登录设备上限至少为 1');
    state.users.push(user); audit(state, actor, 'user.create', user.id);
    assignUserPlan(state, user, actor, body.planId);
    return publicUser(state, user, timezone);
  }
  app.post('/admin/users/create', (req, res) => res.status(201).json(db.transaction(state => createUser(state, req.body || {}, req.user))));
  app.post('/admin/users/:id/update', (req, res) => res.json(db.transaction(state => {
    const user = getUser(state, req.params.id), body = req.body || {};
    validateAssignment(state, body);
    if ('role' in body && body.role !== user.role) fail(403, 'ROLE_FIXED', '账号角色由系统固定，不支持修改');
    if ('username' in body) {
      const username = text(body.username, 'username', 80);
      if (!/^[\p{L}\p{N}_.@-]+$/u.test(username)) fail(400, 'INVALID_USERNAME', '账号仅支持中文、字母、数字、下划线、点、@ 和短横线');
      if (state.users.some(u => u.id !== user.id && u.username.toLowerCase() === username.toLowerCase())) fail(409, 'USER_EXISTS', '账号已存在');
      user.username = username;
    }
    if ('keyId' in body) user.key_id = body.keyId;
    if ('quotas' in body) user.quotas = quotas(body.quotas);
    if ('sessionLimit' in body) {
      user.session_limit = integer(body.sessionLimit, 'sessionLimit', 20);
      if (!user.session_limit) fail(400, 'INVALID_FIELD', '登录设备上限至少为 1');
      state.tokens = state.tokens.filter(t => t.user_id !== user.id);
    }
    audit(state, req.user, 'user.update', user.id);
    return publicUser(state, user, timezone);
  })));
  app.post('/admin/users/:id/status', (req, res) => {
    if (typeof req.body?.isActive !== 'boolean') fail(400, 'INVALID_FIELD', 'isActive must be boolean');
    db.transaction(state => {
      const user = getUser(state, req.params.id);
      if (user.role !== 'user') fail(400, 'ACCOUNT_PROTECTED', '系统账号不支持停用');
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
      const user = getUser(state, req.params.id);
      if (user.role !== 'user') fail(403, 'ACCOUNT_PROTECTED', '管理员和演示账号不支持后台重置密码');
      user.password_hash = hashed;
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
      user.quota_reset_at = now(); audit(state, req.user, 'user.quota.reset', user.id);
    }); res.json({ ok: true });
  });
  app.post('/admin/users/:id/delete', (req, res) => {
    db.transaction(state => {
      const user = getUser(state, req.params.id);
      if (user.role !== 'user') fail(400, 'ACCOUNT_PROTECTED', '系统账号不支持删除');
      if (state.requests.some(r => r.user_id === user.id && r.status === 'pending')) fail(409, 'REQUEST_IN_PROGRESS', '请等待进行中的请求完成后再删除');
      state.users = state.users.filter(u => u.id !== user.id); state.tokens = state.tokens.filter(t => t.user_id !== user.id);
      audit(state, req.user, 'user.delete', user.id);
    }); res.json({ ok: true });
  });
  const publicKey = (state, key) => ({ id: key.id, name: key.name, suffix: key.suffix, active: key.active, health: key.health,
    checked_at: key.checked_at, created_at: key.created_at, assigned_users: state.users.filter(u => u.key_id === key.id).map(u => u.username),
    source_id: keySource(state, key.id)?.id || null, source_name: keySource(state, key.id)?.name || null,
    disabled_reason: key.disabled_reason, disabled_at: key.disabled_at,
    tokens: state.requests.filter(r => r.key_id === key.id).reduce((sum, row) => sum + (row.total_tokens || 0), 0),
    unknown_usage: state.requests.filter(r => r.status !== 'pending' && (r.key_id === key.id ? r.total_tokens == null : r.key_attempts?.some(attempt => attempt.key_id === key.id))).length,
    requests: state.requests.filter(r => r.key_id === key.id || r.key_attempts?.some(attempt => attempt.key_id === key.id)).length });
  function assignKeySource(state, key, sourceId) {
    const current = keySource(state, key.id);
    if ((current?.id || null) === (sourceId || null)) return;
    if (current && state.requests.some(row => row.status === 'pending' && row.key_id === key.id)) fail(409, 'KEY_IN_USE', '请等待此 Key 的进行中请求完成');
    if (current) { bindSourceKeys(state, current, sourceKeyIds(current).filter(id => id !== key.id)); current.revision++; }
    if (sourceId) {
      const source = sourcesFor(state).find(source => source.id === sourceId);
      if (!source) fail(400, 'SOURCE_NOT_FOUND', '请选择有效服务站点');
      bindSourceKeys(state, source, [...sourceKeyIds(source), key.id]); source.revision++;
    }
  }
  app.post('/admin/keys/list', (_req, res) => { const state = db.read(); res.json(state.keys.map(k => publicKey(state, k))); });
  app.post('/admin/keys/create', (req, res) => {
    const entries = req.body?.keys || [req.body];
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) fail(400, 'INVALID_IMPORT', '每次可导入 1～100 个 Key');
    res.status(201).json(db.transaction(state => entries.map(entry => {
      const secret = text(entry?.apiKey, 'apiKey', 4096);
      if (/[\r\n]/.test(secret)) fail(400, 'INVALID_KEY', 'Key 不能包含换行');
      if (state.keys.some(k => vault.decrypt(k.secret) === secret)) fail(409, 'KEY_EXISTS', '此 Key 已存在');
      const key = { id: id(), name: text(entry.name, 'name'), secret: vault.encrypt(secret), suffix: secret.slice(-4), active: true, health: 'unknown', created_at: now() };
      state.keys.push(key); assignKeySource(state, key, entry.sourceId); audit(state, req.user, 'key.create', key.id); return publicKey(state, key);
    })));
  });
  app.post('/admin/keys/:id/update', (req, res) => {
    if (!req.body) fail(400, 'INVALID_REQUEST', '请填写需要保存的内容');
    res.json(db.transaction(state => {
      const key = state.keys.find(k => k.id === req.params.id);
      if (!key) fail(404, 'KEY_NOT_FOUND', 'Key not found');
      if ('active' in req.body) { if (typeof req.body.active !== 'boolean') fail(400, 'INVALID_FIELD', '启用状态必须为布尔值'); key.active = req.body.active; }
      if ('sourceId' in req.body) assignKeySource(state, key, req.body.sourceId);
      if ('active' in req.body) { key.health = key.active ? 'unknown' : 'disabled'; if (!key.active) { key.disabled_reason = '管理员停用'; key.disabled_at = now(); } }
      if ('name' in req.body) key.name = text(req.body.name, 'name');
      if ('apiKey' in req.body) {
        const secret = text(req.body.apiKey, 'apiKey', 4096);
        if (/[\r\n]/.test(secret)) fail(400, 'INVALID_KEY', 'Key 不能包含换行');
        if (state.keys.some(k => k.id !== key.id && vault.decrypt(k.secret) === secret)) fail(409, 'KEY_EXISTS', '此 Key 已存在');
        key.secret = vault.encrypt(secret); key.suffix = secret.slice(-4); key.health = 'unknown';
      }
      if ('apiKey' in req.body || 'active' in req.body) for (const model of state.models) if (model.key_id === key.id || model.verification?.key_id === key.id || sourcesFor(state).some(source => source.id === model.source_id && sourceKeyIds(source).includes(key.id))) model.verification = null;
      audit(state, req.user, 'key.update', key.id); return publicKey(state, key);
    }));
  });
  app.post('/admin/keys/:id/delete', (req, res) => {
    db.transaction(state => {
      if (!state.keys.some(k => k.id === req.params.id)) fail(404, 'KEY_NOT_FOUND', 'Key not found');
      if (sourcesFor(state).some(source=>sourceKeyIds(source).includes(req.params.id)) || state.users.some(u => u.key_id === req.params.id) || state.models.some(m => m.key_id === req.params.id) || state.requests.some(r => r.key_id === req.params.id && r.status === 'pending')) fail(409, 'KEY_IN_USE', '请先解除站点或用户的 Key 绑定，并等待进行中的请求完成');
      state.keys = state.keys.filter(k => k.id !== req.params.id); audit(state, req.user, 'key.delete', req.params.id);
    }); res.json({ ok: true });
  });
  app.post('/admin/keys/:id/check', async (req, res) => {
    const state = db.read(), key = state.keys.find(k => k.id === req.params.id);
    const model = state.models.find(m => req.body?.modelId ? m.id === req.body.modelId : m.is_default);
    if (!key || !model) fail(400, 'INVALID_CHECK', 'Choose a key and model');
    const owner = keySource(state, key.id);
    if (owner && owner.id !== model.source_id) fail(400, 'KEY_SOURCE_CONFLICT', '此 Key 不属于所选模型的服务站点');
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
  app.locals.modelSources=registerModelSources(app,{db,vault,config,saveModel});
  registerModelChecks(app, { db, vault, config, activeRequests });
  app.post('/admin/models/ollama-preset', (_req,res) => res.json({baseUrl:config.ollamaBaseUrl || 'http://localhost:11434/v1',upstreamModel:'qwen:0.5b',maxOutputTokens:256,contextWindow:32768}));
  app.post('/admin/models/list', (_req, res) => {
    const state = db.read(), images = state.settings.imageGeneration;
    res.json(state.models.map(model => ({...model, purposes: [
      ...(images?.enabled && images.sourceId === model.source_id && images.model === model.upstream_model ? ['image_generation'] : []),
      ...(images?.visionModelId === model.id ? ['vision'] : [])
    ]})));
  });
  function saveModel(state, body, existing) {
    for (const price of [body.inputPrice ?? 0, body.outputPrice ?? 0]) if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 100000) fail(400, 'INVALID_PRICE', '单价必须在 0 到 100000 之间');
    if (!['CNY','USD'].includes(body.currency || 'CNY')) fail(400, 'INVALID_CURRENCY', '币种只支持 CNY 或 USD');
    if (!['max_tokens','max_completion_tokens'].includes(body.maxTokensField || 'max_tokens')) fail(400, 'INVALID_FIELD', '无效的输出上限字段');
    if(body.pricingKnown!==undefined&&typeof body.pricingKnown!=='boolean')fail(400,'INVALID_FIELD','pricingKnown 必须为布尔值');
    const protocol = body.protocol ?? existing?.protocol ?? 'chat-completions';
    if (!protocols.includes(protocol)) fail(400, 'INVALID_PROTOCOL', '请选择 Chat Completions 或 Responses 协议');
    const keyId = body.keyId === undefined ? existing?.key_id || null : body.keyId || null;
    if (keyId && !state.keys.some(k => k.id === keyId)) fail(400, 'INVALID_KEY', '请选择存在的模型 Key');
    if (body.supportsVision !== undefined && typeof body.supportsVision !== 'boolean') fail(400, 'INVALID_FIELD', '识图能力必须为布尔值');
    const provider = text(body.provider ?? existing?.provider ?? 'custom', 'provider', 40);
    if (provider === 'ollama' && (protocol !== 'chat-completions' || keyId)) fail(400, 'INVALID_MODEL', 'Ollama 使用 Chat Completions，且无需绑定 Key');
    const model = { ...existing, pricing_known:body.pricingKnown??existing?.pricing_known??true, protocol, provider, key_id: keyId, id: existing?.id || id(), name: text(body.name, 'name'), public_name: text(body.publicName, 'publicName', 80),
      upstream_model: text(body.upstreamModel, 'upstreamModel'), base_url: baseUrl(body.baseUrl),
      max_output_tokens: integer(body.maxOutputTokens ?? 8192, 'maxOutputTokens', 131072),
      context_window: integer(body.contextWindow ?? 131072, 'contextWindow', 2000000), input_price: body.inputPrice ?? 0, output_price: body.outputPrice ?? 0, currency: body.currency || 'CNY', max_tokens_field: body.maxTokensField || 'max_tokens',
      stream_usage: body.streamUsage !== false, active: body.active !== false, is_default: body.isDefault === true, created_at: existing?.created_at || now() };
    if (body.supportsVision !== undefined) model.capabilities = [...new Set([...(existing?.capabilities || []).filter(value => value !== 'vision'), ...(body.supportsVision ? ['vision'] : [])])];
    if (!/^[a-zA-Z0-9_.-]+$/.test(model.public_name) || !model.max_output_tokens || model.context_window < model.max_output_tokens) fail(400, 'INVALID_MODEL', '公开模型名称或上下文/输出上限配置无效');
    const nameKey = model.name.normalize('NFKC').toLowerCase();
    if ((!existing || nameKey !== existing.name.trim().normalize('NFKC').toLowerCase()) && state.models.some(m => m.id !== model.id && m.name.trim().normalize('NFKC').toLowerCase() === nameKey)) fail(409, 'MODEL_NAME_EXISTS', '模型显示名称已存在，请使用其他名称');
    if (state.models.some(m => m.id !== model.id && m.public_name === model.public_name)) fail(409, 'MODEL_EXISTS', 'Public model name already exists');
    if (model.model_type === 'image' && model.is_default) fail(400, 'INVALID_MODEL', '生图模型不能设为默认对话模型');
    if (model.is_default) for (const m of state.models) m.is_default = false;
    if (existing && ['provider','base_url','upstream_model','protocol','key_id','max_tokens_field','stream_usage','max_output_tokens'].some(field => existing[field] !== model[field])) model.verification = null;
    if (existing) Object.assign(existing, model); else state.models.push(model);
    return model;
  }
  app.post('/admin/models/create', (req, res) => res.status(201).json(db.transaction(state => {
    const model = saveModel(state, req.body || {}); audit(state, req.user, 'model.create', model.id); return model;
  })));
  app.post('/admin/models/:id/update', (req, res) => res.json(db.transaction(state => {
    const existing = state.models.find(m => m.id === req.params.id);
    if (!existing) fail(404, 'MODEL_NOT_FOUND', '模型不存在');
    const model = saveModel(state, req.body || {}, existing); audit(state, req.user, 'model.update', model.id); return model;
  })));
  app.post('/admin/usage/query', (req, res) => {
    const state = db.read(), deleted = req.query.modelId === deletedModelId;
    const requests = deleted ? state.requests.filter(row => !state.models.some(model => model.id === row.model_id)) : state.requests;
    res.json(statistics({...state, requests: filterRecords(requests, deleted ? {...req.query, modelId: undefined} : req.query, timezone)}, timezone));
  });
  const page = (items, query) => {
    const offset = integer(Number(query.offset || 0), 'offset'), limit = integer(Number(query.limit || 50), 'limit', 200);
    return { total: items.length, items: items.slice().reverse().slice(offset, offset + limit) };
  };
  app.post('/admin/requests/list', (req, res) => res.json(page(filterRecords(db.read().requests,req.query,timezone), req.query)));
  app.post('/admin/audits/list', (req, res) => res.json(page(filterRecords(db.read().audits,req.query,timezone), req.query)));
  app.post('/admin/system/detail', (_req, res) => res.json({ version: '0.3.0', storage: db.kind, timezone,
    accessTokenMinutes: config.accessTokenMinutes, refreshTokenDays: config.refreshTokenDays, requestTimeoutMs: config.timeoutMs, uptimeSeconds: Math.floor(process.uptime()),
    memoryBytes: process.memoryUsage().rss, maxActiveRequests: db.read().settings.maxActiveRequests || 64,
    pendingRequests: db.read().requests.filter(r => r.status === 'pending').length }));
  app.use('/v1', auth);
  app.get('/v1/models', (req, res) => {
    res.json({ object: 'list', data: availableModels(db.read(), req.user).map(model => ({ id: model.public_name, object: 'model', created: 0, owned_by: 'qcode' })) });
  });
  const queueRequest = createAccountRequestQueue({
    waitMs: config.requestQueueWaitMs ?? 15000,
    canStart: userId => {
      const state = db.read(), user = state.users.find(item => item.id === userId);
      return !user || state.requests.filter(item => item.user_id === userId && item.status === 'pending').length < 1;
    },
  });
  registerImages(app, { db, vault, config, auth, activeRequests, queueRequest });
  registerEmbeddingSettings(app, {db, vault, config});
  app.post('/v1/chat/completions', (req, res) => queueRequest(req, res, () => {
    auth(req, res, () => {});
    return complete(req, res, { db, vault, config, activeRequests });
  }));
  app.use((req, _res) => {
    if (obsoleteBusinessRequest(req.method, req.path)) fail(426, 'CLIENT_UPGRADE_REQUIRED', '接口已升级，请刷新管理端或升级 QCode 客户端');
    fail(404, 'NOT_FOUND', 'Endpoint not found');
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.destroy();
    const status = error.status || 500;
    res.status(status).json({ error: { type: 'gateway_error', code: error.code || (status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'),
      message: error.status && error.code ? error.message : status === 400 ? 'Invalid JSON request' : 'Gateway could not complete the request' } });
  });
  return app;
}
