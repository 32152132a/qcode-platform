import { randomBytes } from 'node:crypto';
import { effectiveQuotas, effectiveKey, permissions } from './policy.js';
export const now = () => new Date().toISOString();
export const id = () => randomBytes(16).toString('hex');
export function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
export function text(value, name, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'INVALID_FIELD', `${name} is required (max ${max} characters)`);
  return value.trim();
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 256) fail(400, 'INVALID_PASSWORD', 'Password must contain 10–256 characters');
  return value;
}
export function integer(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(400, 'INVALID_FIELD', `${name} must be an integer between 0 and ${max}`);
  return value;
}
export function baseUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(400, 'INVALID_URL', 'Invalid model base URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail(400, 'INVALID_URL', 'Use an HTTP(S) base URL without credentials or query');
  return url.href.replace(/\/$/, '');
}
export const quotaNames = ['totalTokens', 'totalRequests', 'dailyTokens', 'dailyRequests', 'monthlyTokens', 'monthlyRequests'];
export function quotas(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_QUOTA', 'quotas must be an object');
  for (const key of Object.keys(value)) if (!quotaNames.includes(key)) fail(400, 'INVALID_QUOTA', `Unknown quota: ${key}`);
  return Object.fromEntries(quotaNames.map(name => [name, integer(value[name] ?? 0, name)]));
}
export function period(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function consumption(state, user, timezone, timestamp = now()) {
  const day = period(timestamp, timezone), used = Object.fromEntries(quotaNames.map(k => [k, 0]));
  used.totalTokens = user.legacy_tokens || 0;
  for (const r of state.requests) {
    if (r.user_id !== user.id || (user.quota_reset_at && r.started_at < user.quota_reset_at)) continue;
    const tokens = r.charged_tokens ?? r.reserved_tokens ?? 0;
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
  const limits = effectiveQuotas(state, user);
  return { id: user.id, username: user.username, role: user.role, is_active: user.is_active,
    department: state.departments.find(d => d.id === user.department_id)?.name || user.department, department_id: user.department_id,
    created_at: user.created_at, last_login_at: user.last_login_at || null,
    model_id: user.model_id, key_id: user.key_id, key_suffix: effectiveKey(state, user)?.suffix || null,
    session_limit: user.session_limit, active_sessions: state.tokens.filter(t => t.user_id === user.id && (t.refresh_expires_at || t.expires_at) > now()).length,
    permissions: permissions(user), max_concurrent_requests: user.max_concurrent_requests || 1, quota_mode: user.quota_mode || 'custom',
    quotas: user.quotas, effective_quotas: limits, used, remaining: Object.fromEntries(quotaNames.map(k => [k, limits[k] ? Math.max(0, limits[k] - used[k]) : null])) };
}
export function audit(state, actor, action, target) {
  state.audits.push({ id: id(), actor_id: actor.id, actor: actor.username, action, target: String(target), time: now() });
}
export function resolveModel(state, user) {
  const modelId = user.model_id || state.departments.find(d => d.id === user.department_id)?.model_id;
  return state.models.find(m => modelId ? m.id === modelId : m.is_default);
}
