import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fail } from './domain.js';

export const knowledgeLimits = { enterprise: 100, personal: 10, bytes: 2 * 1024 * 1024 };
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const words = value => [...new Set([...segmenter.segment(value.toLowerCase())].filter(part => part.isWordLike).map(part => part.segment))];
export function documentChunks(content) {
  const chunks = []; let current = '';
  for (const paragraph of content.split(/\n\s*\n/)) {
    if (current && current.length + paragraph.length > 1200) { chunks.push(current); current = ''; }
    if (paragraph.length > 1200) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += 1200) chunks.push(paragraph.slice(i, i + 1200));
    } else current += (current ? '\n\n' : '') + paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}
function owner(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail(400, 'INVALID_OWNER', '知识库归属无效');
  return BigInt(value);
}
function documentInfo(row) {
  const {content, ...info} = row;
  return {...info, chunks: documentChunks(content).length};
}
export function createKnowledgeStore(filename, { model, dimensions }) {
  if (!model || typeof model !== 'string' || !Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096) throw new Error('Invalid embedding configuration');
  if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive:true});
  const sql = new DatabaseSync(filename, {allowExtension:true});
  try {
    load(sql); sql.enableLoadExtension(false);
    sql.exec('PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    sql.exec('CREATE TABLE IF NOT EXISTS embedding_config(id INTEGER PRIMARY KEY CHECK(id=1), model TEXT NOT NULL, dimensions INTEGER NOT NULL)');
    const previous = sql.prepare('SELECT model, dimensions FROM embedding_config WHERE id=1').get();
    if (previous && (previous.model !== model || previous.dimensions !== dimensions)) fail(409, 'KNOWLEDGE_REINDEX_REQUIRED', '向量模型已变化，请先重建知识库索引');
    sql.prepare('INSERT OR IGNORE INTO embedding_config VALUES(1,?,?)').run(model, BigInt(dimensions));
    sql.exec('CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, title TEXT NOT NULL, filename TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner_id)');
    sql.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING vec0(embedding float[' + dimensions + '], owner_id integer partition key, document_id text, ordinal integer, +content text)');
    sql.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunk_text USING fts5(content, terms, document_id UNINDEXED, owner_id UNINDEXED)');
    function transaction(change) {
      sql.exec('BEGIN IMMEDIATE');
      try { const result = change(); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
    function find(ownerId, id) {
      const row = sql.prepare('SELECT * FROM documents WHERE id=? AND owner_id=?').get(id, owner(ownerId));
      if (!row) fail(404, 'KNOWLEDGE_NOT_FOUND', '文档不存在');
      return row;
    }
    function clearChunks(id) {
      sql.prepare('DELETE FROM chunks WHERE document_id=?').run(id);
      sql.prepare('DELETE FROM chunk_text WHERE document_id=?').run(id);
    }
    function embedding(value) {
      if (!Array.isArray(value) || value.length !== dimensions || value.some(number => typeof number !== 'number' || !Number.isFinite(number))) fail(400, 'INVALID_EMBEDDING', '向量维度或数值无效');
      const result = new Float32Array(value);
      if (result.some(number => !Number.isFinite(number))) fail(400, 'INVALID_EMBEDDING', '向量数值超出范围');
      return result;
    }
    return {
      close: () => sql.close(),
      list: ownerId => sql.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY created_at DESC,id').all(owner(ownerId)).map(documentInfo),
      get: (ownerId, id) => find(ownerId,id),
      save({ownerId, id, title, filename, content}) {
        const ownerIdValue = owner(ownerId);
        if (typeof title !== 'string' || !title.trim() || title.length > 100 || typeof filename !== 'string' || !filename.trim() || filename.length > 200) fail(400, 'INVALID_DOCUMENT', '请填写文档标题和文件名');
        if (typeof content !== 'string' || !content.trim() || content.includes('\0') || Buffer.byteLength(content) > knowledgeLimits.bytes) fail(400, 'INVALID_DOCUMENT', '文档文本为空或超过 2 MiB');
        return transaction(() => {
          if (id) find(ownerId,id);
          else if (sql.prepare('SELECT count(*) AS count FROM documents WHERE owner_id=?').get(ownerIdValue).count >= (ownerId === 0 ? knowledgeLimits.enterprise : knowledgeLimits.personal)) fail(400, 'KNOWLEDGE_LIMIT', ownerId === 0 ? '企业知识库最多 100 份文档' : '个人知识库最多 10 份文档');
          id ||= randomUUID();
          const revision = createHash('sha256').update(content).digest('hex'), timestamp = new Date().toISOString();
          clearChunks(id);
          sql.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,'pending','',?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,filename=excluded.filename,content=excluded.content,revision=excluded.revision,status=excluded.status,error=excluded.error,updated_at=excluded.updated_at").run(id,ownerIdValue,title.trim(),filename,content,revision,timestamp,timestamp);
          return find(ownerId,id);
        });
      },
      complete(ownerId, id, revision, vectors) {
        return transaction(() => {
          const document = find(ownerId,id);
          if (document.revision !== revision) fail(409, 'DOCUMENT_CHANGED', '文档已更新，请重新处理');
          const chunks = documentChunks(document.content);
          if (!Array.isArray(vectors) || vectors.length !== chunks.length) fail(400, 'INVALID_EMBEDDING', '向量数量与文档片段不一致');
          const validated = vectors.map(embedding);
          clearChunks(id);
          const insert = sql.prepare('INSERT INTO chunks(embedding,owner_id,document_id,ordinal,content) VALUES(?,?,?,?,?)');
          const insertText = sql.prepare('INSERT INTO chunk_text(rowid,content,terms,document_id,owner_id) VALUES(?,?,?,?,?)');
          chunks.forEach((content,index) => {
            const {lastInsertRowid} = insert.run(validated[index],owner(ownerId),id,BigInt(index+1),content);
            insertText.run(BigInt(lastInsertRowid),content,words(content).join(' '),id,owner(ownerId));
          });
          sql.prepare("UPDATE documents SET status='ready',error='' WHERE id=?").run(id);
        });
      },
      markFailed(ownerId,id,revision,message) { find(ownerId,id); sql.prepare("UPDATE documents SET status='failed',error=? WHERE id=? AND revision=?").run(String(message).slice(0,200),id,revision); },
      remove(ownerId,id) { return transaction(() => {find(ownerId,id);clearChunks(id);sql.prepare('DELETE FROM documents WHERE id=?').run(id);}); },
      search({userId, query, vector, scope='all', limit=5}) {
        if (!Number.isSafeInteger(userId) || userId < 1) fail(400, 'INVALID_OWNER', '用户身份无效');
        if (!['all','enterprise','personal'].includes(scope) || !Number.isInteger(limit) || limit < 1 || limit > 10 || typeof query !== 'string' || !query.trim() || query.length > 1200) fail(400, 'INVALID_SEARCH', '检索条件无效');
        const queryVector = embedding(vector), owners = scope === 'enterprise' ? [0] : scope === 'personal' ? [userId] : [0,userId];
        const candidates = new Map();
        const add = rows => rows.forEach((row,index) => {const previous=candidates.get(row.rowid);candidates.set(row.rowid,{...row,score:(previous?.score||0)+1/(60+index+1)});});
        const vectorSearch = sql.prepare('SELECT rowid,document_id,ordinal,content FROM chunks WHERE embedding MATCH ? AND k=? AND owner_id=? ORDER BY distance');
        const terms = words(query).slice(0,32).map(term => '"' + term.replaceAll('"','""') + '"').join(' OR ');
        for (const ownerId of owners) {
          add(vectorSearch.all(queryVector,20n,owner(ownerId)));
          if (terms) add(sql.prepare('SELECT rowid,document_id,content FROM chunk_text WHERE terms MATCH ? AND owner_id=? ORDER BY bm25(chunk_text) LIMIT 20').all(terms,owner(ownerId)));
        }
        return [...candidates.values()].sort((a,b)=>b.score-a.score||a.rowid-b.rowid).slice(0,limit).map(row=>{
          const document=sql.prepare('SELECT title,filename,owner_id FROM documents WHERE id=?').get(row.document_id);
          const ordinal=sql.prepare('SELECT ordinal FROM chunks WHERE rowid=?').get(BigInt(row.rowid)).ordinal;
          return {documentId:row.document_id,title:document.title,filename:document.filename,scope:document.owner_id===0?'enterprise':'personal',chunk:ordinal,excerpt:row.content.slice(0,1200),score:row.score};
        });
      },
    };
  } catch(error) { sql.close(); throw error; }
}
