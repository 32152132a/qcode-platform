// One-time prelaunch operation. Stop the gateway first; never run automatically at startup.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createVault } from '../src/database.js';
import { emptyState, normalizeState } from '../src/state.js';

const levels = { '基础版': 0, test: 1, plus: 2, pro: 3 };
const clearedTables = ['planOrders', 'requests', 'audits', 'loginFailures'];
const tables = Object.entries(emptyState()).filter(([, value]) => Array.isArray(value)).map(([name]) => name);

export function prepareLaunchDatabase({ filename, secret, backupPath, apply = false }) {
  if (!fs.existsSync(filename)) throw new Error('Database not found');
  const vault = createVault(secret);
  const sql = new DatabaseSync(filename, { readOnly: !apply });
  try {
    sql.exec('PRAGMA busy_timeout=100;');
    if (apply) sql.exec('BEGIN EXCLUSIVE');
    const version = sql.prepare('PRAGMA user_version').get().user_version;
    const metadata = JSON.parse(sql.prepare('SELECT data FROM metadata WHERE id=1').get().data);
    if (version === 4 && metadata.version === 4 && metadata.settings?.prelaunchCleanupAt) {
      if (apply) sql.exec('ROLLBACK');
      return { alreadyApplied: true, version: 4 };
    }
    if (version !== 3 || metadata.version !== 3) throw new Error('Expected the inspected v3 database; no changes made');
    const state = { ...metadata };
    for (const table of tables) state[table] = sql.prepare('SELECT data FROM "' + table + '" ORDER BY rowid').all().map(row => JSON.parse(row.data));
    const sources = state.settings?.modelSources;
    if (!Array.isArray(sources)) throw new Error('Model sources require separate inspection');
    if (state.subscriptions.length) throw new Error('Subscriptions appeared since inspection; review before cleanup');
    for (const user of state.users) {
      if (user.api_key || user.quota_limit || user.quota_used || user.legacy_tokens) throw new Error('Old user data requires separate inspection');
      for (const field of ['session_limit','max_concurrent_requests','quotas','quota_mode','department_id']) {
        if (!Object.hasOwn(user, field)) throw new Error('Missing user field: ' + field);
      }
    }
    for (const key of state.keys) vault.decrypt(key.secret);
    for (const model of state.models) {
      if (!sources.some(source => source.id === model.source_id)) throw new Error('Unbound model requires separate inspection');
      for (const field of ['context_window','input_price','output_price','currency','max_tokens_field']) {
        if (!Object.hasOwn(model, field)) throw new Error('Missing model field: ' + field);
      }
    }
    const image = state.settings.imageGeneration;
    if (image?.enabled && image.sourceId && image.model && !image.modelId) throw new Error('Standalone image settings require separate inspection');
    if (state.tokens.some(session => !session.id || !session.refresh_hash || !session.refresh_expires_at)) throw new Error('Old sessions require separate inspection');
    const prices = { '基础版': 0, test: 0, plus: 2000, pro: 10000 };
    if (state.plans.length !== 4 || Object.keys(levels).some(name => state.plans.filter(plan => plan.name === name).length !== 1)) throw new Error('Plan list changed; review before cleanup');
    for (const plan of state.plans) if (plan.price_cents !== prices[plan.name] || !plan.active) throw new Error('Plan price or availability changed; review before cleanup');
    const removed = Object.fromEntries(clearedTables.map(table => [table, state[table].length]));
    if (!apply) return { version, removed, levels, defaultPlan: '基础版', requiresStoppedGateway: true };
    if (!backupPath || path.resolve(filename) === path.resolve(backupPath)) throw new Error('A separate backup path is required');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    // Original v3 snapshot: restore with the previous version when rolling back.
    fs.writeFileSync(backupPath, JSON.stringify({ format: 'qcode-encrypted-backup-v1', ciphertext: vault.encrypt(JSON.stringify({format:'qcode-backup-v3', createdAt:new Date().toISOString(), state})) }), { flag: 'wx', mode: 0o600 });
    state.version = 4;
    state.settings.prelaunchCleanupAt = new Date().toISOString();
    const metadataValue = Object.fromEntries(Object.entries(state).filter(([name]) => !tables.includes(name)));
    for (const user of state.users) {
      delete user.legacy_tokens; delete user.quota_limit; delete user.quota_used;
      sql.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(user), String(user.id));
    }
    for (const plan of state.plans) {
      plan.level = levels[plan.name]; plan.is_default = plan.name === '基础版';
      sql.prepare('UPDATE plans SET data=? WHERE id=?').run(JSON.stringify(plan), String(plan.id));
    }
    for (const table of clearedTables) { sql.exec('DELETE FROM "' + table + '"'); state[table] = []; }
    normalizeState(state, vault);
    sql.prepare('UPDATE metadata SET data=? WHERE id=1').run(JSON.stringify(metadataValue));
    sql.exec('PRAGMA user_version=4; COMMIT;');
    return { version: 4, removed, levels, defaultPlan: '基础版', backupPath };
  } catch (error) {
    if (apply) { try { sql.exec('ROLLBACK'); } catch { /* No active transaction. */ } }
    throw error;
  } finally { sql.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(value => value !== '--apply')) throw new Error('Usage: node scripts/prepare-launch.js [--apply]');
    const filename = path.resolve(process.env.DB_PATH || './data/qcode.sqlite');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(process.env.QCODE_LAUNCH_BACKUP || './backups/before-launch-' + stamp + '.qcode-backup');
    console.log(JSON.stringify(prepareLaunchDatabase({filename, secret:process.env.KEY_ENCRYPTION_SECRET, backupPath, apply:args.includes('--apply')})));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
