import { createHash, randomBytes } from 'node:crypto';
import { fail } from './domain.js';

const revision = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const identifier = () => randomBytes(16).toString('hex');
const copy = value => structuredClone(value);
const libraryId = revision('qcode-enterprise-library').slice(0, 32);
const summarize = (value, limit = 100) => value.replace(/[#*_>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);

export function validateLibrary(nodes) {
  if (!Array.isArray(nodes)) fail(400, 'INVALID_KNOWLEDGE', '知识目录格式无效');
  const byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !/^[a-f0-9]{32}$/.test(node.id) || byId.has(node.id))
      fail(400, 'INVALID_KNOWLEDGE', '知识节点标识无效或重复');
    if (!['article', 'folder'].includes(node.kind))
      fail(400, 'INVALID_KNOWLEDGE', '知识节点类型无效');
    if (typeof node.title !== 'string' || !node.title.trim() || [...node.title].length > 100)
      fail(400, 'INVALID_KNOWLEDGE', '知识节点标题须为 1～100 字符');
    const label = '「' + node.title + '」';
    if (typeof node.text !== 'string' || [...node.text].length > 12000 ||
        node.kind === 'article' && !node.text.trim())
      fail(400, 'INVALID_KNOWLEDGE', label + '正文格式无效，文章正文不能为空且最多 12000 字符');
    const summaryLimit = node.kind === 'folder' ? 600 : 100;
    if (typeof node.summary !== 'string' || [...node.summary].length > summaryLimit)
      fail(400, 'INVALID_KNOWLEDGE', label + '摘要须为文本且最多 ' + summaryLimit + ' 字符');
    if (!Array.isArray(node.sources))
      fail(400, 'INVALID_KNOWLEDGE', label + '来源格式无效');
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (!byId.has(parentId) || visited.has(parentId)) fail(400, 'INVALID_KNOWLEDGE_TREE', '目录存在循环或引用了不存在的上级');
      visited.add(parentId);
      parentId = byId.get(parentId).parentId;
    }
  }
}

function refreshFolders(nodes, previous, preserved = new Set()) {
  const before = new Map(previous.map(node => [node.id, node])), after = new Map(nodes.map(node => [node.id, node]));
  const affected = new Set();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (revision(before.get(id)) === revision(after.get(id))) continue;
    for (const collection of [before, after]) {
      let node = collection.get(id);
      while (node) { affected.add(node.id); node = collection.get(node.parentId); }
    }
  }
  const children = new Map();
  for (const node of nodes) {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  }
  const visit = node => {
    const items = children.get(node.id) || [];
    for (const child of items) visit(child);
    if (node.kind === 'folder' && affected.has(node.id) && !preserved.has(node.id)) node.summary = summarize(items.map(child => child.title + '：' + child.summary).join('；'), 600);
  };
  for (const root of children.get(null) || []) visit(root);
}

export function libraryDocuments(snapshot) {
  const ids = new Map(snapshot.nodes.map(node => [node.id, node.id + ':' + snapshot.revision.slice(0, 12)]));
  return snapshot.nodes.length ? [{
    id: libraryId, title: '企业知识库', filename: '企业知识库', scope: 'enterprise', revision: snapshot.revision,
    nodes: snapshot.nodes.map(node => ({
      ...node, id: ids.get(node.id), parentId: ids.get(node.parentId) || null,
      source: { ...(node.sources[0] || {}), articleId: node.id },
    })),
  }] : [];
}

export function createKnowledgeLibrary(sql, transaction) {
  sql.exec("CREATE TABLE IF NOT EXISTS library_versions(revision TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL); CREATE TABLE IF NOT EXISTS library_state(id INTEGER PRIMARY KEY CHECK(id=1),draft TEXT NOT NULL,published TEXT NOT NULL); CREATE TABLE IF NOT EXISTS library_imports(document_id TEXT NOT NULL,revision TEXT NOT NULL,target_id TEXT,target_revision TEXT,PRIMARY KEY(document_id,revision));");
  const empty = { nodes: [], exclusions: [] };
  const emptyRevision = revision(empty);
  sql.prepare('INSERT OR IGNORE INTO library_versions VALUES(?,?,?,?)').run(emptyRevision, JSON.stringify(empty), new Date().toISOString(), 'system');
  sql.prepare('INSERT OR IGNORE INTO library_state VALUES(1,?,?)').run(emptyRevision, emptyRevision);

  function snapshot(which = 'draft') {
    const state = sql.prepare('SELECT * FROM library_state WHERE id=1').get();
    const value = sql.prepare('SELECT * FROM library_versions WHERE revision=?').get(state[which]);
    return { ...JSON.parse(value.data), revision: value.revision, createdAt: value.created_at, actor: value.actor };
  }
  function expect(expected) {
    if (expected !== snapshot().revision) fail(409, 'KNOWLEDGE_CHANGED', '知识库已改变，请刷新后重新操作');
  }
  function save(nodes, exclusions = snapshot().exclusions, actor = 'admin', refresh = true, review = snapshot().revision === snapshot('published').revision ? null : snapshot().review || null) {
    validateLibrary(nodes);
    if (refresh) refreshFolders(nodes, snapshot().nodes);
    const data = { nodes, exclusions, review }, next = revision(data);
    sql.prepare('INSERT OR IGNORE INTO library_versions VALUES(?,?,?,?)').run(next, JSON.stringify(data), new Date().toISOString(), actor);
    sql.prepare('UPDATE library_state SET draft=? WHERE id=1').run(next);
    return detail();
  }
  function changes() {
    const draft = snapshot(), published = snapshot('published'), old = new Map(published.nodes.map(node => [node.id, node]));
    const items = draft.nodes.flatMap(node => {
      const before = old.get(node.id);
      old.delete(node.id);
      return !before ? [{ id: node.id, title: node.title, kind: node.kind, operation: 'add' }]
        : revision(before) !== revision(node) ? [{ id: node.id, title: node.title, kind: node.kind, operation: 'update' }] : [];
    });
    return [...items, ...[...old.values()].map(node => ({ id: node.id, title: node.title, kind: node.kind, operation: 'delete' }))];
  }
  function detail() {
    const draft = snapshot();
    const published = snapshot('published');
    const review = draft.revision !== published.revision ? draft.review || null : null;
    return { ...draft, review, publishedNodes: published.nodes, deleted: published.nodes.filter(node => !draft.nodes.some(current => current.id === node.id)), changes: changes(), publishedRevision: published.revision };
  }
  function sourcesForNodes(nodes) {
    return [...new Map(nodes.flatMap(node => node.sources).map(source => [source.documentId + ':' + source.revision + ':' + source.blockId, source])).values()];
  }
  function applyPlan(base, plan) {
    if (!Array.isArray(plan.changes) || !plan.changes.length || plan.changes.length > 100)
      fail(400, 'INVALID_KNOWLEDGE_PLAN', '美化建议应包含 1～100 项修改');
    const nodes = copy(base.nodes), used = new Set(), added = new Map();
    for (const change of plan.changes) {
      if (change.operation === 'add') {
        if (typeof change.id !== 'string' || !change.id || added.has(change.id) || nodes.some(node => node.id === change.id))
          fail(400, 'INVALID_KNOWLEDGE_PLAN', '新增节点标识重复');
        added.set(change.id, identifier());
      }
    }
    for (const change of plan.changes) {
      if (!change || !['add', 'update', 'delete'].includes(change.operation) || used.has(change.id) ||
          typeof change.reason !== 'string' || !change.reason.trim())
        fail(400, 'INVALID_KNOWLEDGE_PLAN', '美化建议包含重复或无效操作');
      used.add(change.id);
      const node = nodes.find(node => node.id === change.id);
      if (change.operation !== 'add' && !node) fail(400, 'INVALID_KNOWLEDGE_PLAN', '建议引用了不存在的文章');
      if (change.operation === 'delete') {
        nodes.splice(nodes.indexOf(node), 1);
        continue;
      }
      const sourceNodes = Array.isArray(change.sourceNodeIds)
        ? base.nodes.filter(item => change.sourceNodeIds.includes(item.id)) : [];
      if (change.operation === 'add' && change.kind !== 'folder' && !sourceNodes.length)
        fail(400, 'INVALID_KNOWLEDGE_PLAN', '新增文章必须关联已读取的知识来源');
      const parentId = change.parentId === undefined ? node?.parentId ?? null : change.parentId;
      const value = {
        id: node?.id || added.get(change.id), parentId: added.get(parentId) ?? parentId,
        title: change.title === undefined ? node?.title : change.title,
        kind: change.kind === undefined ? node?.kind ?? 'article' : change.kind,
        text: change.text === undefined ? node?.text ?? '' : change.text,
        summary: change.summary === undefined ? node?.summary ?? '' : change.summary,
        sources: sourcesForNodes([...(node ? [node] : []), ...sourceNodes]),
      };
      if (node) Object.assign(node, value); else nodes.push(value);
    }
    const key = source => source.documentId + ':' + source.revision + ':' + source.blockId;
    const covered = new Set(sourcesForNodes(nodes).map(key));
    const exclusions = plan.exclusions || [];
    for (const item of exclusions) {
      const sourceNodes = base.nodes.filter(node => item.sourceNodeIds?.includes(node.id));
      for (const source of sourcesForNodes(sourceNodes)) covered.add(key(source));
    }
    if (sourcesForNodes(base.nodes).some(source => !covered.has(key(source))))
      fail(400, 'KNOWLEDGE_COVERAGE_MISSING', '美化建议遗漏了原文来源，请补充保留位置或排除原因后重试');
    validateLibrary(nodes);
    const preserved = new Set(plan.changes.filter(change => change.kind === 'folder' && typeof change.summary === 'string').map(change => added.get(change.id) || change.id));
    refreshFolders(nodes, base.nodes, preserved);
    return { nodes, changes: plan.changes.map(change => ({ id: added.get(change.id) || change.id, operation: change.operation, reason: change.reason })) };
  }
  function importReview(base, changes, plan) {
    const previous = base.review;
    const newExclusions = (plan.exclusions || []).map(item => ({
      ...item,
      titles: item.sourceNodeIds.map(id => base.nodes.find(node => node.id === id)?.title).filter(Boolean),
    }));
    const merged = new Map((previous?.changes || []).map(change => [change.id, change]));
    for (const change of changes) merged.set(change.id, change);
    return {newExclusions, value: {
      changes: [...merged.values()],
      warnings: [...new Set([...(previous?.warnings || []), ...(plan.warnings || [])])],
      exclusions: [...(previous?.exclusions || []), ...newExclusions],
    }};
  }
  function removalImpact(ids, expected) {
    expect(expected);
    const base = snapshot();
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
        ids.some(id => !base.nodes.some(node => node.id === id && node.kind === 'article')))
      fail(400, 'INVALID_NODES', '请选择需要删除的文章');
    const selected = new Set(ids);
    let size;
    do {
      size = selected.size;
      for (const node of base.nodes) if (selected.has(node.parentId)) selected.add(node.id);
    } while (selected.size !== size);
    const articles = base.nodes.filter(node => selected.has(node.id) && node.kind === 'article');
    return { ids: [...selected], titles: articles.map(node => node.title), count: articles.length };
  }
  return {
    detail, snapshot, expect, removalImpact, documents: () => libraryDocuments(snapshot('published')),
    trackImport(documentId, sourceRevision, targetId, expected) {
      if (targetId) {
        expect(expected);
        const node = snapshot().nodes.find(node => node.id === targetId && node.kind === 'article');
        if (!node) fail(404, 'KNOWLEDGE_NOT_FOUND', '需要替换的文章不存在');
        sql.prepare('INSERT OR REPLACE INTO library_imports VALUES(?,?,?,?)').run(documentId, sourceRevision, targetId, revision(node));
      } else sql.prepare('INSERT OR REPLACE INTO library_imports VALUES(?,?,NULL,NULL)').run(documentId, sourceRevision);
    },
    prepareImport(job, sections) {
      const mapping = sql.prepare('SELECT * FROM library_imports WHERE document_id=? AND revision=?').get(job.document_id, job.revision);
      if (!mapping) fail(409, 'KNOWLEDGE_IMPORT_MISSING', '上传任务缺少文章关联，请重新上传');
      const draft = snapshot(), nodes = copy(draft.nodes);
      const evidence = section => ({ documentId: job.document_id, revision: job.revision, blockId: section.id, filename: job.filename, ...section.source });
      let previous = null;
      const incomingIds = [];
      if (mapping.target_id) {
        const target = nodes.find(node => node.id === mapping.target_id);
        if (!target || revision(target) !== mapping.target_revision) fail(409, 'KNOWLEDGE_CHANGED', '文章在上传期间已修改，请重新替换');
        previous = draft.nodes.find(node => node.id === target.id);
        incomingIds.push(target.id);
        const text = sections.map(section => section.text).join('\n\n');
        if ([...text].length > 12000) fail(400, 'SECTION_TOO_LARGE', '替换后的单篇文章超过12000字，请拆分后新增上传');
        Object.assign(target, { text, summary: summarize(text), sources: sections.map(evidence) });
      } else {
        const rootId = identifier(), ids = new Map(sections.map(section => [section.id, identifier()]));
        nodes.push({ id: rootId, parentId: null, kind: 'folder', title: job.title, summary: '', text: '', sources: [] });
        for (const section of sections) {
          incomingIds.push(ids.get(section.id));
          const body = section.text.replace(/^#{1,6}\s+[^\n]+/, '').trim();
          const hasChildren = sections.some(child => child.parentId === section.id);
          nodes.push({
            id: ids.get(section.id), parentId: ids.get(section.parentId) || rootId,
            kind: !body && hasChildren ? 'folder' : 'article', title: section.title,
            summary: summarize(body || section.title), text: section.text, sources: [evidence(section)],
          });
        }
      }
      validateLibrary(nodes);
      refreshFolders(nodes, draft.nodes);
      const published = snapshot('published');
      const review = draft.revision === published.revision ? null : draft.review;
      return { ...draft, nodes, review, incomingIds, previous };
    },
    applyImportPlan(staged, plan) {
      if (!plan.changes.length && plan.exclusions?.length)
        fail(400, 'INVALID_KNOWLEDGE_PLAN', '排除原文需要同时说明对应的目录改动');
      const result = plan.changes.length ? applyPlan(staged, plan) : {nodes: staged.nodes, changes: []};
      const review = importReview(staged, result.changes, plan);
      return { ...staged, nodes: result.nodes, exclusions: [...staged.exclusions, ...review.newExclusions], review: review.value };
    },
    commitImport(staged) {
      expect(staged.revision);
      return save(staged.nodes, staged.exclusions, 'admin', false, staged.review);
    },
    remove(ids, expected) {
      return transaction(() => {
        const selected = new Set(removalImpact(ids, expected).ids), base = snapshot();
        let nodes = copy(base.nodes).filter(node => !selected.has(node.id));
        let empty;
        do {
          empty = new Set(nodes.filter(node => node.kind === 'folder' && !nodes.some(child => child.parentId === node.id)).map(node => node.id));
          nodes = nodes.filter(node => !empty.has(node.id));
        } while (empty.size);
        const exclusions = [...base.exclusions, ...base.nodes.filter(node => selected.has(node.id)).map(node => ({ title: node.title, sources: node.sources, reason: '管理员删除文章' }))];
        return save(nodes, exclusions);
      });
    },
    beautify(plan, expected) {
      return transaction(() => {
        expect(expected);
        if (!plan.changes.length) return detail();
        const base = snapshot(), result = applyPlan(base, plan), nodes = result.nodes;
        if (revision(nodes) === revision(base.nodes) && !plan.exclusions?.length) return detail();
        const review = importReview(base.revision === snapshot('published').revision ? {...base, review: null} : base, result.changes, plan);
        return save(nodes, [...base.exclusions, ...review.newExclusions], 'admin', false, review.value);
      });
    },
    publish(expected, actor) {
      return transaction(() => {
        expect(expected);
        const current = snapshot();
        validateLibrary(current.nodes);
        const unfinished = sql.prepare("SELECT count(*) AS count FROM versions v JOIN documents d ON d.id=v.document_id AND d.draft_revision=v.revision WHERE d.owner_id=0 AND v.status IN ('pending','processing')").get().count;
        if (unfinished) fail(409, 'KNOWLEDGE_PROCESSING', '还有上传任务正在处理，请等待完成');
        if (!changes().length) fail(409, 'KNOWLEDGE_UNCHANGED', '没有待发布的变更');
        sql.prepare('UPDATE library_state SET published=? WHERE id=1').run(current.revision);
        sql.prepare('UPDATE library_versions SET actor=? WHERE revision=?').run(actor, current.revision);
        return detail();
      });
    },

  };
}