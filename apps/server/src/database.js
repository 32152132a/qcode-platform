import fs from 'node:fs';
import path from 'node:path';
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
// Single-process store: persist an atomic snapshot before publishing each transaction.
export function createDatabase(filename = ':memory:', options = {}) {
  if (filename === ':sqlite:' || /\.(sqlite|db)$/i.test(filename)) return createSqliteDatabase(filename, options);
  const file = filename === ':memory:' ? null : path.resolve(filename);
  let lock;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { lock = fs.openSync(`${file}.lock`, 'wx', 0o600); }
    catch { throw new Error('Database locked. Stop the other gateway; after a crash verify it stopped before removing the .lock file.'); }
    fs.writeFileSync(lock, String(process.pid));
  }
  const close = () => {
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(`${file}.lock`); lock = undefined; }
  };
  try {
    let state = emptyState();
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw.users) || !Array.isArray(raw.tokens)) throw new Error('Invalid database format');
      state = { ...state, ...raw };
    }
    const persist = next => {
      if (!file) return;
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        const fd = fs.openSync(temporary, 'w', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(temporary, file);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    };
    const db = {
      kind: file ? 'atomic-json' : 'memory',
      read: () => structuredClone(state),
      transaction(change) {
        const next = structuredClone(state), result = change(next);
        if (result && typeof result.then === 'function') throw new Error('Database transactions must be synchronous');
        persist(next);
        state = next;
        return result;
      },
      close,
    };
    db.transaction(next => normalizeState(next, options.vault));
    return db;
  } catch (error) { close(); throw error; }
}
