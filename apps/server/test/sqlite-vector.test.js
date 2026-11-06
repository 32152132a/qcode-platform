import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('packaged vectors persist and search only enterprise or the authorized owner partition', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qcode-vector-'));
  const filename = join(directory, 'knowledge.sqlite');
  let db;
  function open() {
    const database = new DatabaseSync(filename, { allowExtension: true });
    try { load(database); database.enableLoadExtension(false); return database; }
    catch (error) { database.close(); throw error; }
  }
  const vector = value => new Float32Array(value);
  try {
    db = open();
    assert.match(db.prepare('SELECT vec_version() AS version').get().version, /^v?0\.1\.9/);
    db.exec('CREATE VIRTUAL TABLE chunks USING vec0(embedding float[3], owner_id integer partition key, document_id text, content text)');
    const insert = db.prepare('INSERT INTO chunks(rowid, embedding, owner_id, document_id, content) VALUES(?, ?, ?, ?, ?)');
    insert.run(1n, vector([1,0,0]), 0n, 'enterprise', '团队资料');
    insert.run(2n, vector([0.9,0.1,0]), 1n, 'personal-one', '用户一资料');
    insert.run(3n, vector([1,0,0]), 2n, 'personal-two', '用户二资料');
    db.close(); db = open();
    const search = db.prepare('SELECT rowid, document_id, content, distance FROM chunks WHERE embedding MATCH ? AND k = ? AND owner_id = ? ORDER BY distance');
    const allowed = [0,1].flatMap(owner => search.all(vector([1,0,0]), 5n, BigInt(owner)));
    assert.deepEqual(allowed.map(row => row.document_id).sort(), ['enterprise','personal-one']);
    assert(allowed.every(row => Number.isFinite(row.distance)));
    db.prepare('DELETE FROM chunks WHERE rowid = ?').run(2n);
    assert.equal(search.all(vector([1,0,0]), 5n, 1n).length, 0);
    assert.equal(search.all(vector([1,0,0]), 5n, 2n).length, 1);
    assert.throws(() => search.all(vector([1,0]), 5n, 0n), /dimension/i);
    assert.throws(() => db.loadExtension('untrusted-extension'));
  } finally { db?.close(); rmSync(directory, {recursive:true,force:true}); }
});
