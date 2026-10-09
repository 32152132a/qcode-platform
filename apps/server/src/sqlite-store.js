import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { emptyState, normalizeState } from './state.js';
const require = createRequire(import.meta.url);
const tables = ['users', 'tokens', 'keys', 'models', 'departments', 'skills', 'requests', 'audits', 'loginFailures'];
const primary = (table, row) => table === 'tokens' ? row.token_hash : String(row.id);

// The gateway owns one connection. SQLite supplies ACID transactions and incremental row persistence.
export function createSqliteDatabase(filename, { vault } = {}) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { throw new Error('SQLite storage requires Node.js 24 LTS. Use the bundled QCode runtime or QCODE_NODE.'); }
  const file = filename === ':sqlite:' ? ':memory:' : path.resolve(filename);
  let sql;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const close = () => {
    sql?.close(); sql = null;
  };
  try {
    sql = new DatabaseSync(file);
    // SQLite's OS lock is released even after a hard process crash; no stale PID file blocks restart.
    sql.exec('PRAGMA busy_timeout=100; PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE; COMMIT;');
    sql.exec('CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL CHECK(json_valid(data)))');
    for (const table of tables) sql.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`);
    sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS username_unique ON users(lower(json_extract(data, '$.username')));
      CREATE INDEX IF NOT EXISTS request_user_time ON requests(json_extract(data, '$.user_id'), json_extract(data, '$.started_at'));
      CREATE INDEX IF NOT EXISTS request_department ON requests(json_extract(data, '$.department_id'));
      CREATE INDEX IF NOT EXISTS session_user ON tokens(json_extract(data, '$.user_id'));
      CREATE UNIQUE INDEX IF NOT EXISTS session_refresh ON tokens(json_extract(data, '$.refresh_hash'));
      PRAGMA user_version=3;`);
    if (sql.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed');
    let state = emptyState();
    const metadata = sql.prepare('SELECT data FROM metadata WHERE id=1').get();
    if (metadata) Object.assign(state, JSON.parse(metadata.data));
    for (const table of tables) state[table] = sql.prepare(`SELECT data FROM "${table}" ORDER BY rowid`).all().map(row => JSON.parse(row.data));
    const statements = Object.fromEntries(tables.map(table => [table, {
      put: sql.prepare(`INSERT INTO "${table}" (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`),
      remove: sql.prepare(`DELETE FROM "${table}" WHERE id=?`),
    }]));
    function persist(next) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        for (const table of tables) {
          const previous = new Map(state[table].map(row => [primary(table, row), JSON.stringify(row)]));
          const retained = new Set(next[table].map(row => primary(table, row)));
          for (const key of previous.keys()) if (!retained.has(key)) statements[table].remove.run(key);
          for (const row of next[table]) {
            const key = primary(table, row), value = JSON.stringify(row);
            if (previous.get(key) !== value) statements[table].put.run(key, value);
          }
        }
        const rest = Object.fromEntries(Object.entries(next).filter(([key]) => !tables.includes(key)));
        sql.prepare('INSERT INTO metadata(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(rest));
        sql.exec('COMMIT');
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
    const db = {
      kind: 'sqlite-wal',
      read: () => structuredClone(state),
      transaction(change) {
        const next = structuredClone(state), result = change(next);
        if (result && typeof result.then === 'function') throw new Error('Database transactions must be synchronous');
        persist(next); state = next; return result;
      },
      export: () => structuredClone(state),
      close,
    };
    db.transaction(next => normalizeState(next, vault));
    return db;
  } catch (error) { close(); throw error; }
}
