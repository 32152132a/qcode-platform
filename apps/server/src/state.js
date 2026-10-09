import { randomBytes } from 'node:crypto';
export function emptyState() {
  return { version: 3, users: [], tokens: [], keys: [], models: [], departments: [], skills: [], requests: [], audits: [], loginFailures: [], settings: {}, nextUserId: 1 };
}
export function normalizeState(state, vault) {
  if (state.version > 3) throw new Error('Database was created by a newer QCode version');
  for (const [name, value] of Object.entries(emptyState())) state[name] ??= structuredClone(value);
  for (const name of ['users','tokens','keys','models','departments','skills','requests','audits','loginFailures']) {
    if (!Array.isArray(state[name])) throw new Error(`Invalid database collection: ${name}`);
  }
  state.nextUserId = state.users.reduce((max, user) => Math.max(max, user.id + 1), state.nextUserId);
  for (const user of state.users) {
    user.session_limit ??= 1;
    user.max_concurrent_requests ??= 1;
    user.model_id ??= null;
    user.key_id ??= null;
    user.department ??= '';
    user.department_id ??= null;
    user.quota_mode ??= 'custom';
    user.quotas ??= { totalTokens: user.quota_limit || 0, totalRequests: 0, dailyTokens: 0, dailyRequests: 0, monthlyTokens: 0, monthlyRequests: 0 };
    user.legacy_tokens ??= user.quota_used || 0;
    if (user.department && !user.department_id) {
      let department = state.departments.find(d => d.name === user.department);
      if (!department) {
        department = { id: randomBytes(16).toString('hex'), name: user.department, active: true, model_id: null, key_id: null,
          quotas: { totalTokens: 0, totalRequests: 0, dailyTokens: 0, dailyRequests: 0, monthlyTokens: 0, monthlyRequests: 0 },
          user_quotas: { totalTokens: 0, totalRequests: 0, dailyTokens: 0, dailyRequests: 0, monthlyTokens: 0, monthlyRequests: 0 }, created_at: new Date().toISOString() };
        state.departments.push(department);
      }
      user.department_id = department.id;
    }
    if (user.api_key) {
      if (!vault) throw new Error('Encryption secret required to migrate existing API keys');
      const keyId = randomBytes(16).toString('hex');
      state.keys.push({ id: keyId, name: `Migrated: ${user.username}`, secret: vault.encrypt(user.api_key), suffix: user.api_key.slice(-4), active: true, health: 'unknown', created_at: new Date().toISOString() });
      user.key_id = keyId;
    }
    delete user.api_key;
  }
  for (const model of state.models) {
    model.context_window ??= 131072;
    model.input_price ??= 0;
    model.output_price ??= 0;
    model.currency ??= 'CNY';
    model.max_tokens_field ??= 'max_tokens';
  }
  for (const request of state.requests) if (request.status === 'pending') {
    Object.assign(request, { status: 'interrupted', error_code: 'GATEWAY_RESTARTED', usage_source: 'reservation', charged_tokens: request.reserved_tokens, finished_at: new Date().toISOString() });
  }
  if (vault) for (const key of state.keys) vault.decrypt(key.secret);
  state.version = 3;
}
