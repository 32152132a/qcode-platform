import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fail } from './domain.js';

export const revisionOf = value => createHash('sha256').update(value).digest('hex');
export const knowledgeLimits = { enterprise: 100, personal: 10 };
export function createTreeStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const sql = new DatabaseSync(filename);
  sql.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL,title TEXT NOT NULL,draft_revision TEXT NOT NULL,published_revision TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS document_owner ON documents(owner_id);
    CREATE TABLE IF NOT EXISTS versions(document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,revision TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,original BLOB NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',nodes TEXT,created_at TEXT NOT NULL,PRIMARY KEY(document_id,revision));
    CREATE TABLE IF NOT EXISTS proposals(document_id TEXT NOT NULL,revision TEXT NOT NULL,changes TEXT NOT NULL,PRIMARY KEY(document_id,revision),FOREIGN KEY(document_id,revision) REFERENCES versions(document_id,revision) ON DELETE CASCADE);
    UPDATE versions SET status='pending',error='' WHERE status='processing';`);
  const transaction = change => { sql.exec('BEGIN IMMEDIATE'); try { const result = change(); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } };
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
    const draft = sql.prepare('SELECT filename,status,error,length(original) AS bytes,json_array_length(nodes) AS sections FROM versions WHERE document_id=? AND revision=?').get(row.id, row.draft_revision);
    return { ...row, ...draft, changes: changes(row.id,row.draft_revision).length, published: Boolean(row.published_revision), scope: row.owner_id === 0 ? 'enterprise' : 'personal' };
  }
  const changes=(id,revision)=>JSON.parse(sql.prepare('SELECT changes FROM proposals WHERE document_id=? AND revision=?').get(id,revision)?.changes||'[]');
  function visibleNodes(nodes,ownerId){
    const allowed=nodes.filter(node=>(node.sources||[]).every(source=>sql.prepare('SELECT 1 FROM documents d JOIN versions v ON d.id=v.document_id WHERE d.id=? AND v.revision=? AND d.owner_id=? AND d.active=1 AND d.published_revision IS NOT NULL').get(source.documentId,source.revision,ownerId)));
    const present=new Set(allowed.map(node=>node.id));
    return allowed.map(node=>({...node,parentId:present.has(node.parentId)?node.parentId:null}));
  }
  function visible(userId, id) {
    const row = sql.prepare('SELECT * FROM documents WHERE id=? AND (owner_id=0 OR owner_id=?) AND active=1 AND published_revision IS NOT NULL').get(id, userId);
    if (!row) fail(404, 'KNOWLEDGE_NOT_FOUND', '资料不存在或未发布');
    return row;
  }
  return {
    close: () => sql.close(),
    list: ownerId => sql.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY updated_at DESC,id').all(ownerId).map(metadata),
    catalogue(userId) {
      return sql.prepare('SELECT * FROM documents WHERE (owner_id=0 OR owner_id=?) AND active=1 AND published_revision IS NOT NULL ORDER BY title,id').all(userId)
        .map(row => { const data = version(row.id, row.published_revision); return { id: row.id, title: row.title, scope: row.owner_id === 0 ? 'enterprise' : 'personal', revision: data.revision, filename: data.filename, nodes: visibleNodes(JSON.parse(data.nodes),row.owner_id) }; });
    },
    detail(ownerId, id) { const row = document(ownerId, id), data = version(id, row.draft_revision); return { ...metadata(row), nodes: data.nodes ? JSON.parse(data.nodes) : [], proposals:changes(id,row.draft_revision) }; },
    published(userId, id) { const row = visible(userId, id), data = version(id, row.published_revision); return { id: row.id, title: row.title, scope: row.owner_id === 0 ? 'enterprise' : 'personal', revision: data.revision, filename: data.filename, nodes: visibleNodes(JSON.parse(data.nodes),row.owner_id) }; },
    original(ownerId, id, revision) { const row = document(ownerId,id), data = sql.prepare('SELECT filename,mime,original FROM versions WHERE document_id=? AND revision=?').get(id,revision || row.draft_revision);if(!data)fail(404,'KNOWLEDGE_NOT_FOUND','原文版本不存在');return { filename: data.filename, mime: data.mime, data: Buffer.from(data.original).toString('base64') }; },
    upload(ownerId, { id, title, filename, mime, bytes }) {
      if(id!==undefined&&(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)))fail(400,'INVALID_DOCUMENT','资料ID无效');
      if (!Number.isSafeInteger(ownerId) || ownerId < 0) fail(400, 'INVALID_OWNER', '资料归属无效');
      if (typeof title !== 'string' || !title.trim() || title.length > 100) fail(400, 'INVALID_DOCUMENT', '标题需为1～100字');
      if (typeof filename !== 'string' || filename.length > 180 || /[\\/\x00-\x1f]/.test(filename) || !/\.(md|txt|pdf|docx|xlsx)$/i.test(filename)) fail(400, 'INVALID_KNOWLEDGE_FILE', '支持 TXT、Markdown、PDF、DOCX、XLSX，文件名不能包含路径');
      if (!Buffer.isBuffer(bytes) || !bytes.length) fail(400, 'INVALID_KNOWLEDGE_FILE', '文件不能为空');
      return transaction(() => {
        const revision = revisionOf(Buffer.concat([Buffer.from(filename + '\n'), bytes]));
        if (id) document(ownerId,id);
        const duplicate=id?sql.prepare('SELECT d.* FROM documents d JOIN versions v ON d.id=v.document_id AND d.draft_revision=v.revision WHERE d.id=? AND v.filename=? AND v.original=?').get(id,filename,bytes):sql.prepare('SELECT d.* FROM documents d JOIN versions v ON d.id=v.document_id AND d.draft_revision=v.revision WHERE d.owner_id=? AND v.filename=? AND v.original=?').get(ownerId,filename,bytes);
        if(duplicate)return {...metadata(duplicate),skipped:true};
        if (!id&&sql.prepare('SELECT count(*) AS count FROM documents WHERE owner_id=?').get(ownerId).count >= (ownerId === 0 ? knowledgeLimits.enterprise : knowledgeLimits.personal)) fail(400,'KNOWLEDGE_LIMIT', ownerId === 0 ? '企业资料最多100份' : '个人资料最多10份');
        id ||= randomBytes(16).toString('hex');
        const timestamp = new Date().toISOString();
        sql.prepare('INSERT INTO documents VALUES(?,?,?,?,NULL,1,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,draft_revision=excluded.draft_revision,updated_at=excluded.updated_at').run(id,ownerId,title.trim(),revision,timestamp,timestamp);
        sql.prepare("INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,'pending','',NULL,?)").run(id,revision,filename,mime || 'application/octet-stream',bytes,timestamp);
        return metadata(document(ownerId,id));
      });
    },
    next() {
      const row = sql.prepare("SELECT v.*,d.owner_id,d.title FROM versions v JOIN documents d ON d.id=v.document_id AND d.draft_revision=v.revision WHERE v.status='pending' ORDER BY v.created_at LIMIT 1").get();
      if (!row) return null;
      sql.prepare("UPDATE versions SET status='processing' WHERE document_id=? AND revision=?").run(row.document_id,row.revision);
      return row;
    },
    complete(id, revision, nodes, proposals=[]) {
      transaction(() => {
        const row = sql.prepare('SELECT * FROM documents WHERE id=?').get(id); if (!row || row.draft_revision !== revision) return;
        sql.prepare("UPDATE versions SET status='ready',error='',nodes=? WHERE document_id=? AND revision=?").run(JSON.stringify(nodes),id,revision);
        sql.prepare('INSERT OR REPLACE INTO proposals VALUES(?,?,?)').run(id,revision,JSON.stringify(proposals));
      });
    },
    failed(id, revision, message) { sql.prepare("UPDATE versions SET status='failed',error=? WHERE document_id=? AND revision=?").run(String(message).slice(0,200),id,revision); },
    retry(ownerId, id) { const row = document(ownerId,id), data = version(id,row.draft_revision); if (!['failed','ready'].includes(data.status)||row.draft_revision===row.published_revision) fail(409,'DOCUMENT_BUSY','仅失败或未发布的资料可以重新处理'); sql.prepare("UPDATE versions SET status='pending',error='' WHERE document_id=? AND revision=?").run(id,row.draft_revision);sql.prepare('DELETE FROM proposals WHERE document_id=? AND revision=?').run(id,row.draft_revision); },
    edit(ownerId,id,{revision,nodeId,proposalIndex,title,summary,text}) {
      return transaction(() => {
        const row = document(ownerId,id); if (row.draft_revision !== revision) fail(409,'DOCUMENT_CHANGED','资料已更新，请刷新');
        const data = version(id,revision); if (data.status !== 'ready') fail(409,'DOCUMENT_BUSY','资料尚未处理完成');
        if (row.published_revision === revision) fail(409,'DOCUMENT_PUBLISHED','请先撤回发布再修改目录');
        const nodes = JSON.parse(data.nodes),items=changes(id,revision);
        if(proposalIndex!==undefined&&(!Number.isSafeInteger(proposalIndex)||proposalIndex<0||proposalIndex>=items.length))fail(400,'INVALID_PROPOSAL','修改建议不存在');
        const node=proposalIndex===undefined?nodes.find(node=>node.id===nodeId):items[proposalIndex];
        if (!node || typeof title !== 'string' || !title.trim() || [...title].length > 100 || typeof summary !== 'string' || [...summary].length > 100) fail(400,'INVALID_NODE','标题或摘要无效，最多100字');
        if(text!==undefined&&(typeof text!=='string'||!text.trim()||[...text].length>12000))fail(400,'INVALID_NODE','正文不能为空，最多12000字');
        const changedText=text!==undefined&&text!==node.text;
        node.title = title.trim(); node.summary = summary;
        if(text!==undefined)node.text=text;
        const retained=proposalIndex===undefined&&changedText?items.filter(item=>!item.sourceNodeIds.includes(nodeId)):items;
        if(proposalIndex===undefined)sql.prepare('UPDATE versions SET nodes=? WHERE document_id=? AND revision=?').run(JSON.stringify(nodes),id,revision);
        sql.prepare('UPDATE proposals SET changes=? WHERE document_id=? AND revision=?').run(JSON.stringify(retained),id,revision);
        return{discardedChanges:items.length-retained.length};
      });
    },
    dismiss(ownerId,id,revision,index){
      const row=document(ownerId,id);
      if(row.draft_revision!==revision||row.published_revision===revision)fail(409,'DOCUMENT_CHANGED','草稿已改变，请刷新');
      const items=changes(id,revision);if(!Number.isSafeInteger(index)||index<0||index>=items.length)fail(400,'INVALID_PROPOSAL','修改建议不存在');
      items.splice(index,1);sql.prepare('UPDATE proposals SET changes=? WHERE document_id=? AND revision=?').run(JSON.stringify(items),id,revision);
    },
    publish(ownerId,id,revision){return this.publishMany(ownerId,[{id,revision}]);},
    publishMany(ownerId,items){
      if(!Array.isArray(items)||!items.length||items.length>knowledgeLimits.enterprise||items.some(item=>!item||typeof item.id!=='string'||!/^[a-f0-9]{32}$/.test(item.id)||typeof item.revision!=='string'||!/^[a-f0-9]{64}$/.test(item.revision))||new Set(items.map(item=>item.id)).size!==items.length)fail(400,'INVALID_PUBLICATION','请选择1～100份不同资料，并提供当前版本');
      return transaction(()=>{
        const selected=items.map(item=>{const row=document(ownerId,item.id);if(row.draft_revision!==item.revision||version(row.id,item.revision).status!=='ready')fail(409,'DOCUMENT_CHANGED','资料尚未就绪或版本已变化，请刷新后发布');return{row,data:version(row.id,item.revision),proposals:row.published_revision===item.revision?[]:changes(row.id,item.revision)};});
        const targets=new Map(),updated=new Set();
        for(const source of selected)for(const change of source.proposals){
          const row=document(ownerId,change.documentId);
          if(row.published_revision!==change.baseRevision||row.draft_revision!==change.baseRevision||selected.some(item=>item.row.id===row.id&&item.row.draft_revision!==change.baseRevision))fail(409,'KNOWLEDGE_PLAN_STALE','关联资料已修改或撤回，请重新处理这份草稿');
          let target=targets.get(row.id);
          if(!target){target={row,data:version(row.id,change.baseRevision),nodes:JSON.parse(version(row.id,change.baseRevision).nodes)};targets.set(row.id,target);}
          const node=target.nodes.find(node=>node.id===change.nodeId),key=row.id+':'+change.nodeId;
          if(change.operation==='update'&&(!node||updated.has(key)))fail(409,'KNOWLEDGE_PLAN_CONFLICT','多份资料同时修改了同一章节，请查看“有更新”并忽略重复建议后再一键发布');
          if(change.operation==='update')updated.add(key);
          const evidence=change.sourceNodeIds.map(id=>{const found=JSON.parse(source.data.nodes).find(node=>node.id===id);if(!found)fail(409,'KNOWLEDGE_PLAN_STALE','新资料依据已变化');return{documentId:source.row.id,revision:source.row.draft_revision,nodeId:found.id,filename:source.data.filename,...found.source};});
          const previous=node?(node.sources||[{documentId:row.id,revision:change.baseRevision,nodeId:node.id,filename:target.data.filename,...node.source}]):[];
          const sources=[...new Map([...previous,...evidence].map(item=>[item.documentId+':'+item.revision+':'+item.nodeId,item])).values()];
          const value={id:node?.id||randomBytes(16).toString('hex'),parentId:node?.parentId||change.parentId||null,title:change.title,summary:change.summary,text:change.text,source:node?.source||evidence[0],sources};
          if(node)Object.assign(node,value);else target.nodes.push(value);
          if(target.nodes.length>400)fail(400,'TOO_MANY_SECTIONS','关联资料超过400个节点，请先拆分');
        }
        for(const {row,data,nodes}of targets.values()){
          const revision=revisionOf(JSON.stringify(nodes)+randomBytes(16).toString('hex')),ids=new Map(nodes.map((node,index)=>[node.id,`${row.id}:${revision.slice(0,12)}:${index}`]));
          const rewritten=nodes.map(node=>({...node,id:ids.get(node.id),parentId:ids.get(node.parentId)||null}));
          sql.prepare("INSERT INTO versions SELECT document_id,?,filename,mime,original,'ready','',?,? FROM versions WHERE document_id=? AND revision=?").run(revision,JSON.stringify(rewritten),new Date().toISOString(),row.id,data.revision);
          sql.prepare('UPDATE documents SET draft_revision=?,published_revision=?,updated_at=? WHERE id=?').run(revision,revision,new Date().toISOString(),row.id);
        }
        for(const {row}of selected){
          if(!targets.has(row.id))sql.prepare('UPDATE documents SET published_revision=?,active=1 WHERE id=?').run(row.draft_revision,row.id);
          sql.prepare('DELETE FROM proposals WHERE document_id=? AND revision=?').run(row.id,row.draft_revision);
        }
        return{published:selected.length,updated:targets.size};
      });
    },
    unpublish(ownerId,id) { document(ownerId,id); sql.prepare('UPDATE documents SET published_revision=NULL WHERE id=?').run(id); },
    remove(ownerId,id) { document(ownerId,id); sql.prepare('DELETE FROM documents WHERE id=?').run(id); },
    download(ownerId,id){
      if(!ownerId)fail(403,'INVALID_OWNER','仅个人处理任务可以下载');
      const row=document(ownerId,id),data=version(id,row.draft_revision);
      if(data.status!=='ready')fail(409,'DOCUMENT_BUSY','资料尚未解析完成');
      const original=this.original(ownerId,id,row.draft_revision);
      return{document:{id:row.id,title:row.title,filename:data.filename,revision:row.draft_revision,nodes:JSON.parse(data.nodes)},original,checksum:revisionOf(Buffer.from(original.data,'base64'))};
    },
    received(ownerId,id,revision){
      return transaction(()=>{const row=document(ownerId,id);if(!ownerId||row.draft_revision!==revision||version(id,revision).status!=='ready')fail(409,'DOCUMENT_CHANGED','下载版本已变化，未清理服务器文件');sql.prepare('DELETE FROM documents WHERE id=?').run(id);});
    },
  };
}
