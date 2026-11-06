import { subscriptionFor, modelAllowed } from './entitlements.js';
import { randomBytes } from 'node:crypto';
import { effectiveQuotas, effectiveKey, permissions } from './policy.js';
export const now = () => new Date().toISOString();
export const id = () => randomBytes(16).toString('hex');
export function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
const fieldLabel = name => ({username:'账号',name:'名称',apiKey:'API Key',provider:'服务提供商',publicName:'公开模型标识',upstreamModel:'上游模型名称',maxOutputTokens:'最大输出 Token',contextWindow:'上下文上限',sessionLimit:'登录设备上限',totalTokens:'总 Token 额度',totalRequests:'总请求额度',dailyTokens:'每日 Token 额度',dailyRequests:'每日请求额度',monthlyTokens:'每月 Token 额度',monthlyRequests:'每月请求额度'}[name] || name);
export function text(value, name, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'INVALID_FIELD', `${fieldLabel(name)}不能为空，且不能超过 ${max} 个字符`);
  return value.trim();
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 256) fail(400, 'INVALID_PASSWORD', '密码须为 10～256 个字符');
  return value;
}
export function integer(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(400, 'INVALID_FIELD', `${fieldLabel(name)}须为 0～${max} 之间的整数`);
  return value;
}
export function baseUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(400, 'INVALID_URL', '模型服务地址格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail(400, 'INVALID_URL', '请使用 HTTP 或 HTTPS 基础地址，不包含账号密码、查询参数或锚点');
  return url.href.replace(/\/$/, '');
}
export const quotaNames = ['totalTokens', 'totalRequests', 'dailyTokens', 'dailyRequests', 'monthlyTokens', 'monthlyRequests'];
export function quotas(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_QUOTA', '额度配置格式不正确');
  for (const key of Object.keys(value)) if (!quotaNames.includes(key)) fail(400, 'INVALID_QUOTA', `不支持的额度配置项：${key}`);
  return Object.fromEntries(quotaNames.map(name => [name, integer(value[name] ?? 0, name)]));
}
export function period(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// Reservations protect in-flight quotas; completed requests use provider usage only.
export function quotaTokens(request) {
  const value = request.status === 'pending' ? request.reserved_tokens : request.total_tokens;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function consumption(state, user, timezone, timestamp = now()) {
  const day = period(timestamp, timezone), used = Object.fromEntries(quotaNames.map(k => [k, 0]));
  const subscription = subscriptionFor(state, user);
  const startsAt = [user.quota_reset_at, subscription?.started_at].filter(Boolean).sort().at(-1);
  used.totalTokens = 0;
  for (const r of state.requests) {
    if (r.user_id !== user.id || (subscription && r.subscription_id !== subscription.id) || (startsAt && r.started_at < startsAt)) continue;
    const tokens = quotaTokens(r);
    used.totalTokens += tokens;
    used.totalRequests++;
    const requestDay = period(r.started_at, timezone);
    if (requestDay === day) { used.dailyTokens += tokens; used.dailyRequests++; }
    if (requestDay.slice(0, 7) === day.slice(0, 7)) { used.monthlyTokens += tokens; used.monthlyRequests++; }
  }
  return used;
}
export function publicUser(state, user, timezone) {
  const used = consumption(state, user, timezone);
  const limits = effectiveQuotas(state, user), subscription=subscriptionFor(state,user);
  return { id: user.id, username: user.username, role: user.role, is_active: user.is_active,
    plan_id: subscription?.plan_id || null, plan_name: subscription?.terms.name || null, plan_model_ids: subscription?.terms.model_ids || null,
    created_at: user.created_at, last_login_at: user.last_login_at || null,
    key_id: user.key_id, key_suffix: effectiveKey(state, user)?.suffix || null,
    session_limit: user.session_limit, active_sessions: state.tokens.filter(t => t.user_id === user.id && t.refresh_expires_at > now()).length,
    permissions: permissions(user),
    quotas: user.quotas, effective_quotas: limits, used, remaining: Object.fromEntries(quotaNames.map(k => [k, limits[k] != null ? Math.max(0, limits[k] - used[k]) : null])) };
}
export function audit(state, actor, action, target) {
  state.audits.push({ id: id(), actor_id: actor.id, actor: actor.username, action, target: String(target), time: now() });
}
export const availableModels = (state, user) => state.models.filter(model => model.model_type !== 'image' && !model.capabilities?.includes('embedding') && (!user || modelAllowed(state, user, model)) && model.active && model.catalog_available !== false && (!model.source_id || (state.settings.modelSources || []).some(source => source.id === model.source_id && source.active)));
export function resolveModel(state, user) {
  const models = availableModels(state, user);
  return models.find(model => model.is_default) || models[0];
}
