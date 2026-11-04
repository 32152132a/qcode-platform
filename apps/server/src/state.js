export function emptyState() {
  return { version: 5, users: [], tokens: [], keys: [], models: [], skills: [], feedback: [], plans: [], planOrders: [], subscriptions: [], paymentSettings: [], requests: [], audits: [], loginFailures: [], settings: { modelSources: [] }, nextUserId: 1 };
}
export function normalizeState(state, vault) {
  if (state.version !== 5) throw new Error('Unsupported database version; see docs/ADMIN-ACCOUNTS.md and run the reviewed offline migration before starting.');
  for (const [name, value] of Object.entries(emptyState())) {
    if (Array.isArray(value) && !Array.isArray(state[name])) throw new Error('Invalid database collection: ' + name);
  }
  if (!state.settings || !Array.isArray(state.settings.modelSources) || !Number.isSafeInteger(state.nextUserId)) throw new Error('Invalid database metadata');
  for (const request of state.requests) if (request.status === 'pending') {
    Object.assign(request, { status: 'interrupted', error_code: 'GATEWAY_RESTARTED', usage_source: 'unknown', charged_tokens: request.total_tokens ?? 0, finished_at: new Date().toISOString() });
  }
  if (vault) for (const key of state.keys) vault.decrypt(key.secret);
}
