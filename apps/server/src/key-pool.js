import { fail, now } from './domain.js';

// A source has one preferred key followed by ordered fallback keys.
export const sourceKeyIds = source => [...new Set([source.key_id, ...(source.fallback_key_ids || [])].filter(Boolean))];
export const keySource = (state, keyId) => state.settings.modelSources.find(source => sourceKeyIds(source).includes(keyId));
export const sourceKey = (state, source) => sourceKeyIds(source).map(id => state.keys.find(key => key.id === id)).find(key => key?.active);

export function bindSourceKeys(state, source, ids) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) fail(400, 'INVALID_KEY', '请选择最多 100 个 Key');
  const unique = [...new Set(ids)];
  for (const id of unique) {
    if (!state.keys.some(key => key.id === id)) fail(400, 'INVALID_KEY', 'Key 不存在');
    const owner = keySource(state, id);
    if (owner && owner.id !== source.id) fail(409, 'KEY_SOURCE_CONFLICT', 'Key 已归属其他服务站点，请先解除绑定');
  }
  if (source.kind === 'local' && unique.length) fail(400, 'INVALID_KEY', '本地 Ollama 无需 Key');
  const changed = JSON.stringify(sourceKeyIds(source)) !== JSON.stringify(unique);
  source.key_id = unique[0] || null;
  source.fallback_key_ids = unique.slice(1);
  for (const model of state.models.filter(model => changed && model.source_id === source.id)) { model.key_id = source.key_id; model.verification = null; }
}

export function configureKeyRecovery(key, body) {
  if (body.restoreHours !== undefined) {
    if (!Number.isInteger(body.restoreHours) || body.restoreHours < 0 || body.restoreHours > 8760) fail(400, 'INVALID_RECOVERY', '恢复间隔应为 0～8760 小时，0 表示不自动恢复');
    key.restore_hours = body.restoreHours;
  }
  if (body.restoreAt !== undefined) {
    if (body.restoreAt && (typeof body.restoreAt !== 'string' || !Number.isFinite(Date.parse(body.restoreAt)) || Date.parse(body.restoreAt) <= Date.now())) fail(400, 'INVALID_RECOVERY', '请选择未来的恢复时间');
    key.restore_at = body.restoreAt ? new Date(body.restoreAt).toISOString() : null;
  }
}

export function suspendKey(db, key, reason) {
  if (!key) return;
  db.transaction(state => {
    const saved = state.keys.find(item => item.id === key.id);
    if (!saved?.active || saved.secret !== key.secret) return;
    Object.assign(saved, { active: false, health: 'suspended', disabled_reason: reason, disabled_at: now() });
    if (saved.restore_at && saved.restore_at <= now()) saved.restore_at = null;
    if (!saved.restore_at && saved.restore_hours) saved.restore_at = new Date(Date.now() + saved.restore_hours * 3600000).toISOString();
  });
}

export function restoreDueKeys(db, timestamp = now()) {
  if (!db.read().keys.some(key => !key.active && key.restore_at && key.restore_at <= timestamp)) return;
  db.transaction(state => {
    for (const key of state.keys) if (!key.active && key.restore_at && key.restore_at <= timestamp) {
      Object.assign(key, { active: true, restore_at: null, health: 'unknown' });
    }
  });
}

export const keyFailure = status => ({401:'鉴权失败',402:'余额或额度不足',403:'访问权限不足',408:'上游超时',429:'上游限流或额度不足'}[status] || (status >= 500 ? '上游服务异常' : null));

// Only rejected requests are retried; a successful response body is never replayed.
export async function fetchWithKeys({db, keys, build, signal, attempt = () => {}}) {
  for (const key of keys) {
    if (key && !db.read().keys.some(saved => saved.id === key.id && saved.active && saved.secret === key.secret)) continue;
    const {url, ...options} = build(key);
    attempt(key);
    let response;
    try {
      response = await fetch(url, { ...options, signal, redirect: 'error' });
    } catch (error) {
      if (!signal?.aborted || signal.reason?.name === 'TimeoutError') suspendKey(db, key, signal?.aborted ? '上游请求超时' : '上游网络连接失败');
      throw error;
    }
    const reason = keyFailure(response.status);
    if (!reason || !key) return response;
    await response.body?.cancel();
    suspendKey(db, key, reason);
  }
  fail(503, 'KEY_UNAVAILABLE', '此模型暂无可用 Key，请联系管理员');
}
