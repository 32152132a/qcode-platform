import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fail } from './domain.js';
import { createKnowledgeLibrary } from './knowledge-library.js';

export const revisionOf = value => createHash('sha256').update(value).digest('hex');
export const knowledgeLimits = { enterprise: 100, personal: 10 };

export function createTreeStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const sql = new DatabaseSync(filename);
  sql.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL,title TEXT NOT NULL,draft_revision TEXT NOT NULL,published_revision TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS document_owner ON documents(owner_id); CREATE TABLE IF NOT EXISTS versions(document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,revision TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,original BLOB NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',nodes TEXT,created_at TEXT NOT NULL,PRIMARY KEY(document_id,revision)); UPDATE versions SET status='pending',error='' WHERE status='processing';");
  const transaction = change => {
    sql.exec('BEGIN IMMEDIATE');
    try { const result = change(); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  };
  const library = createKnowledgeLibrary(sql, transaction);
  function document(ownerId, id) {
    const row = sql.prepare('SELECT * FROM documents WHERE id=? AND owner_id=?').get(id, ownerId);
    if (!row) fail(404, 'KNOWLEDGE_NOT_FOUND', '资料不存在或无权访问');
    return row;
  }
  function version(id, revision) {
    const row = sql.prepare('SELECT document_id,revision,filename,mime,status,error,nodes,created_at FROM versions WHERE document_id=? AND revision=?').get(id, revision);
    if (!row) fail(404, 'KNOWLEDGE_NOT_FOUND', '资料版本不存在');
    return row;
  }
  function metadata(row) {
    const data = version(row.id, row.draft_revision);
    const { nodes, ...value } = data;
    const size = sql.prepare('SELECT length(original) AS bytes FROM versions WHERE document_id=? AND revision=?').get(row.id, row.draft_revision).bytes;
    return { ...row, ...value, bytes: size, published: false, sections: nodes ? JSON.parse(nodes).length : 0 };
  }
  return {
    library, close: () => sql.close(),
    list: ownerId => sql.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY updated_at DESC,id').all(ownerId).map(metadata),
    catalogue: () => library.documents(),
    published(_userId, id) {
      const value = library.documents().find(item => item.id === id);
      if (!value) fail(404, 'KNOWLEDGE_NOT_FOUND', '资料不存在或未发布');
      return value;
    },
    detail(ownerId, id) {
      const row = document(ownerId, id), data = version(id, row.draft_revision);
      return { ...metadata(row), nodes: data.nodes ? JSON.parse(data.nodes) : [] };
    },
    original(ownerId, id, sourceRevision) {
      const row = document(ownerId, id);
      const data = sql.prepare('SELECT filename,mime,original FROM versions WHERE document_id=? AND revision=?').get(id, sourceRevision || row.draft_revision);
      if (!data) fail(404, 'KNOWLEDGE_NOT_FOUND', '原文版本不存在');
      return { filename: data.filename, mime: data.mime, data: Buffer.from(data.original).toString('base64') };
    },
    upload(ownerId, { id, title, filename, mime, bytes, targetId, expectedRevision }) {
      if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) fail(400, 'INVALID_DOCUMENT', '资料ID无效');
      if (!Number.isSafeInteger(ownerId) || ownerId < 0) fail(400, 'INVALID_OWNER', '资料归属无效');
      if (ownerId && (targetId !== undefined || expectedRevision !== undefined)) fail(400, 'INVALID_DOCUMENT', '个人上传不接受企业文章参数');
      if (typeof title !== 'string' || !title.trim() || title.length > 100) fail(400, 'INVALID_DOCUMENT', '标题需为1～100字');
      if (typeof filename !== 'string' || filename.length > 180 || /[\\/\x00-\x1f]/.test(filename) || !/\.(md|txt|pdf|docx|xlsx)$/i.test(filename))
        fail(400, 'INVALID_KNOWLEDGE_FILE', '支持 TXT、Markdown、PDF、DOCX、XLSX，文件名不能包含路径');
      if (!Buffer.isBuffer(bytes) || !bytes.length) fail(400, 'INVALID_KNOWLEDGE_FILE', '文件不能为空');
      return transaction(() => {
        const sourceRevision = revisionOf(Buffer.concat([Buffer.from(filename + '\n'), bytes]));
        if (id) document(ownerId, id);
        let duplicate = !targetId && (id
          ? sql.prepare('SELECT d.* FROM documents d JOIN versions v ON d.id=v.document_id AND d.draft_revision=v.revision WHERE d.id=? AND v.filename=? AND v.original=?').get(id, filename, bytes)
          : sql.prepare('SELECT d.* FROM documents d JOIN versions v ON d.id=v.document_id AND d.draft_revision=v.revision WHERE d.owner_id=? AND v.filename=? AND v.original=?').get(ownerId, filename, bytes));
        if (duplicate && ownerId === 0) {
          const tracked = sql.prepare('SELECT 1 FROM library_imports WHERE document_id=? AND revision=?').get(duplicate.id, duplicate.draft_revision);
          const ready = version(duplicate.id, duplicate.draft_revision).status === 'ready';
          const retained = library.snapshot().nodes.some(node => node.sources.some(source => source.documentId === duplicate.id));
          if (!tracked || ready && !retained) duplicate = null;
        }
        if (duplicate) return { ...metadata(duplicate), skipped: true };
        let count;
        if (ownerId === 0) {
          const sources = new Set(library.snapshot().nodes.flatMap(node => node.sources.map(source => source.documentId)));
          const queued = sql.prepare("SELECT d.id FROM documents d JOIN versions v ON v.document_id=d.id AND v.revision=d.draft_revision JOIN library_imports i ON i.document_id=d.id AND i.revision=d.draft_revision WHERE d.owner_id=0 AND i.target_id IS NULL AND v.status!='ready'").all();
          for (const item of queued) sources.add(item.id);
          count = sources.size;
        } else count = sql.prepare('SELECT count(*) AS count FROM documents WHERE owner_id=?').get(ownerId).count;
        if (!id && !targetId && count >= (ownerId === 0 ? knowledgeLimits.enterprise : knowledgeLimits.personal))
          fail(400, 'KNOWLEDGE_LIMIT', ownerId === 0 ? '企业资料最多100份' : '个人资料最多10份');
        id ||= randomBytes(16).toString('hex');
        const timestamp = new Date().toISOString();
        sql.prepare('INSERT INTO documents VALUES(?,?,?,?,NULL,1,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,draft_revision=excluded.draft_revision,updated_at=excluded.updated_at')
          .run(id, ownerId, title.trim(), sourceRevision, timestamp, timestamp);
        sql.prepare("INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,'pending','',NULL,?)").run(id, sourceRevision, filename, mime || 'application/octet-stream', bytes, timestamp);
        if (ownerId === 0) library.trackImport(id, sourceRevision, targetId, expectedRevision);
        return metadata(document(ownerId, id));
      });
    },
    next() {
      const row = sql.prepare("SELECT v.*,d.owner_id,d.title FROM versions v JOIN documents d ON d.id=v.document_id AND d.draft_revision=v.revision WHERE v.status='pending' ORDER BY v.created_at LIMIT 1").get();
      if (!row) return null;
      sql.prepare("UPDATE versions SET status='processing' WHERE document_id=? AND revision=?").run(row.document_id, row.revision);
      return row;
    },
    complete(id, sourceRevision, nodes, stagedImport) {
      return transaction(() => {
        const row = sql.prepare('SELECT * FROM documents WHERE id=?').get(id);
        if (!row || row.draft_revision !== sourceRevision) return;
        if (row.owner_id === 0) library.commitImport(stagedImport);
        sql.prepare("UPDATE versions SET status='ready',error='',nodes=? WHERE document_id=? AND revision=?").run(JSON.stringify(nodes), id, sourceRevision);
      });
    },
    failed(id, sourceRevision, message, needsRecognition = false) {
      sql.prepare('UPDATE versions SET status=?,error=? WHERE document_id=? AND revision=?').run(needsRecognition ? 'needs_recognition' : 'failed', String(message).slice(0, 200), id, sourceRevision);
    },
    retry(ownerId, id) {
      const row = document(ownerId, id), data = version(id, row.draft_revision);
      if (data.status !== 'failed') fail(409, 'DOCUMENT_BUSY', '仅失败的上传任务可以重试');
      sql.prepare("UPDATE versions SET status='pending',error='' WHERE document_id=? AND revision=?").run(id, row.draft_revision);
    },
    remove(ownerId, id) {
      const row = document(ownerId, id), data = version(id, row.draft_revision);
      if (ownerId === 0 && !['failed', 'needs_recognition'].includes(data.status)) fail(409, 'DOCUMENT_BUSY', '仅支持移除失败或待识别的上传任务；文章请在目录中删除');
      sql.prepare('DELETE FROM documents WHERE id=?').run(id);
    },
    download(ownerId, id) {
      if (!ownerId) fail(403, 'INVALID_OWNER', '仅个人处理任务可以下载');
      const row = document(ownerId, id), data = version(id, row.draft_revision);
      if (data.status !== 'ready') fail(409, 'DOCUMENT_BUSY', '资料尚未解析完成');
      const original = this.original(ownerId, id, row.draft_revision);
      return { document: { id: row.id, title: row.title, filename: data.filename, revision: row.draft_revision, nodes: JSON.parse(data.nodes) }, original, checksum: revisionOf(Buffer.from(original.data, 'base64')) };
    },
    received(ownerId, id, sourceRevision) {
      return transaction(() => {
        const row = document(ownerId, id);
        if (!ownerId || row.draft_revision !== sourceRevision || version(id, sourceRevision).status !== 'ready')
          fail(409, 'DOCUMENT_CHANGED', '下载版本已变化，未清理服务器文件');
        sql.prepare('DELETE FROM documents WHERE id=?').run(id);
      });
    },
  };
}