import { emptyState, normalizeState } from './state.js';
import { createSqliteDatabase } from './sqlite-store.js';
import { createHash, randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !/^[a-f0-9]{64}$/.test(hash || '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(hash, 'hex'));
}
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
export function createVault(masterKey) {
  if (!/^[a-f0-9]{64}$/i.test(masterKey || '')) throw new Error('KEY_ENCRYPTION_SECRET must be 64 hexadecimal characters');
  const key = Buffer.from(masterKey, 'hex');
  return {
    encrypt(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64')).join('.');
    },
    decrypt(value) {
      const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    },
  };
}
// Tests use isolated memory stores; persistent data uses SQLite only.
export function createDatabase(filename = ':memory:', options = {}) {
  if (filename === ':sqlite:' || /\.(sqlite|db)$/i.test(filename)) return createSqliteDatabase(filename, options);
  if (filename !== ':memory:') throw new Error('Only SQLite database files (.sqlite or .db) are supported');
  let state = emptyState();
  normalizeState(state, options.vault);
  return {
    kind: 'memory', read: () => structuredClone(state), close() {},
    transaction(change) {
      const next = structuredClone(state), result = change(next);
      if (result && typeof result.then === 'function') throw new Error('Database transactions must be synchronous');
      state = next; return result;
    },
  };
}
