import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseDocuments, buildIndex, answerQuestion, createChatClient } from '../scripts/tree-rag.mjs';

export const documents = [
  { filename: '差旅制度.md', content: '# 差旅制度\n生效日期：2026年1月1日。适用于普通员工。\n## 上海住宿\n上海出差住宿每人每晚不超过500元，需要住宿发票。\n## 北京住宿\n北京出差住宿每人每晚不超过450元。\n## 报销审批\n报销须直属主管批准。' },
  { filename: '项目补充通知.md', content: '# 项目补充通知\n2026年重大项目出差除差旅制度外，还需遵守本通知。\n## 审批补充\n重大项目的住宿报销还需项目负责人批准，不替代直属主管审批。\n## 无关代码\n```md\n# 不应变成目录的代码\n```' },
  { filename: '个人备忘.md', content: '# 出差提醒\n## 个人事项\n周五给家人打电话，不是企业报销制度。' },
];
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const action = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(name === 'finish_answer' ? { supported: true, ...args } : args) } }] });
const reply = message => ({ message, usage });
const scripted = steps => async (messages, tools) => {
  assert.ok(steps.length, 'unexpected model call');
  const step = steps.shift(); return reply(typeof step === 'function' ? step(messages, tools) : step);
};

test('Markdown structure preserves hierarchy, evidence lines and fenced code', () => {
  const index = parseDocuments(documents);
  const heading = index.nodes.find(node => node.title === '上海住宿');
  assert.equal(heading.startLine, 3); assert.equal(heading.endLine, 4);
  assert.equal(heading.text, '## 上海住宿\n上海出差住宿每人每晚不超过500元，需要住宿发票。');
  assert.equal(index.nodes.find(node => node.id === heading.parentId).title, '差旅制度');
  assert.ok(!index.nodes.some(node => node.title === '不应变成目录的代码'));
  assert.equal(index.documents.length, 3);
  assert.notEqual(parseDocuments([{ ...documents[0], content: documents[0].content + '\n变更' }]).documents[0].revision, index.documents[0].revision);
  assert.throws(() => parseDocuments([documents[0], documents[0]]), /名称不能重复/);
  assert.throws(() => parseDocuments([{ filename: 'long.md', content: '字'.repeat(12001) }]), /单节超过/);
});

test('index summaries are generated once per document and must match original IDs', async () => {
  let calls = 0;
  const index = await buildIndex(documents, async messages => {
    calls++;
    return reply({ role: 'assistant', content: JSON.stringify({ nodes: JSON.parse(messages[1].content).map(node => ({ id: node.id, summary: node.text ? node.title + '的摘要' : '' })) }) });
  });
  assert.equal(calls, 3); assert.equal(index.indexing.calls, 3);
  const section = index.nodes.find(node => node.title === '上海住宿');
  assert.ok(section.summary); assert.match(section.text, /500元/);
  await assert.rejects(buildIndex([documents[0]], async () => reply({ content: '{"nodes":[]}' })), /摘要节点/);
  await assert.rejects(buildIndex([documents[0]], async messages => reply({ content: JSON.stringify({
    nodes: JSON.parse(messages[1].content).map(node => ({ id: node.id, summary: '字'.repeat(101) })),
  }) })), /超过 100 字符/);
});

test('navigation can read multiple documents and returns verifiable source paths', async () => {
  const index = parseDocuments(documents);
  const lodging = index.nodes.find(node => node.title === '上海住宿');
  const approval = index.nodes.find(node => node.title === '审批补充');
  const result = await answerQuestion(index, '重大项目去上海出差标准和额外审批是什么？', scripted([
    (messages, tools) => {
      assert.ok(messages[0].content.includes(lodging.id));
      assert.ok(messages[0].content.includes(approval.id));
      assert.deepEqual(tools.map(tool => tool.function.name), ['read_nodes', 'finish_answer']);
      return action('read_nodes', { ids: [lodging.id, approval.id] });
    },
    messages => {
      const evidence = JSON.parse(messages.at(-1).content);
      assert.equal(evidence.length, 4);
      assert.ok(evidence.some(node => node.text.includes('生效日期：2026年1月1日。适用于普通员工。')));
      return action('finish_answer', { answer: '上海每晚500元；重大项目另需项目负责人批准。', citations: [
        { nodeId: lodging.id, quote: '上海出差住宿每人每晚不超过500元，需要住宿发票。' },
        { nodeId: approval.id, quote: '重大项目的住宿报销还需项目负责人批准，不替代直属主管审批。' },
      ] });
    },
  ]));
  assert.equal(result.calls.model, 2); assert.equal(result.calls.tools, 2);
  assert.equal(result.citations[0].filename, '差旅制度.md');
  assert.equal(result.citations[0].startLine, 3);
  assert.deepEqual(result.trace.map(item => item.tool), ['read_nodes', 'finish_answer']);
});

test('supplementary reads include missing evidence without repeating already read parent text', async () => {
  const index = parseDocuments(documents);
  const lodging = index.nodes.find(node => node.title === '上海住宿');
  const approval = index.nodes.find(node => node.title === '报销审批');
  const result = await answerQuestion(index, '住宿与审批', scripted([
    action('read_nodes', { ids: [lodging.id] }),
    action('read_nodes', { ids: [lodging.id, approval.id] }),
    messages => {
      const evidence = JSON.parse(messages.at(-1).content);
      assert.equal(evidence.find(node => node.id === lodging.id).alreadyRead, true);
      assert.equal(evidence.find(node => node.id === lodging.id).text, undefined);
      assert.equal(evidence.find(node => node.id === lodging.parentId).alreadyRead, true);
      assert.equal(evidence.find(node => node.id === approval.id).text, approval.text);
      return action('finish_answer', { answer: '住宿500元以内，需直属主管批准。', citations: [
        { nodeId: lodging.id, quote: '上海出差住宿每人每晚不超过500元，需要住宿发票。' },
        { nodeId: approval.id, quote: '报销须直属主管批准。' },
      ] });
    },
  ]));
  assert.equal(result.calls.model, 3); assert.equal(result.citations.length, 2);
});

test('unread or invented citations are rejected; missing evidence cannot become an uncited answer', async () => {
  const index = parseDocuments(documents), node = index.nodes.find(node => node.title === '上海住宿');
  const result = await answerQuestion(index, '深圳标准？', scripted([
    action('finish_answer', { answer: '深圳900元', citations: [{ nodeId: node.id, quote: '深圳900元' }] }),
    messages => {
      assert.match(JSON.parse(messages.at(-1).content).error, /已读取/);
      return action('read_nodes', { ids: [node.id] });
    },
    action('finish_answer', { answer: '深圳900元', citations: [{ nodeId: node.id, quote: '深圳900元' }] }),
    action('finish_answer', { answer: '没有引用但我认为深圳900元', citations: [] }),
  ]));
  assert.match(result.answer, /未找到足够依据/);
  assert.equal(result.citations.length, 0);
  assert.equal(result.trace.filter(item => item.error).length, 2);
});

test('invalid node IDs are not readable and repetitive navigation is bounded', async () => {
  const index = parseDocuments(documents);
  let calls = 0;
  await assert.rejects(answerQuestion(index, '不断翻目录', async messages => {
    if (calls++) assert.match(JSON.parse(messages.at(-1).content).error, /不存在/);
    return reply(action('read_nodes', { ids: ['outside-library'] }));
  }), /调用上限/);
  assert.equal(calls, 4);
});

test('related evidence cannot replace an explicit insufficient-evidence result', async () => {
  const index = parseDocuments(documents), node = index.nodes.find(node => node.title === '上海住宿');
  const result = await answerQuestion(index, '深圳出差住宿标准？', scripted([
    action('read_nodes', { ids: [node.id] }),
    action('finish_answer', { supported: false, answer: '没有深圳标准，但上海500元。', citations: [
      { nodeId: node.id, quote: '上海出差住宿每人每晚不超过500元，需要住宿发票。' },
    ] }),
  ]));
  assert.equal(result.supported, false);
  assert.match(result.answer, /未找到足够依据/);
  assert.deepEqual(result.citations, []);
});

test('OpenAI-compatible transport sends tools, records usage and hides upstream error bodies', async () => {
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer local-test');
    if (body.model === 'fail') { res.writeHead(401); res.end('private upstream detail'); return; }
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.messages[1].content, '什么都没有');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: action('finish_answer', { answer: '无依据', citations: [] }) }], usage }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test', model: 'test' };
    const result = await answerQuestion(parseDocuments(documents), '什么都没有', createChatClient(config));
    assert.equal(result.usage[0].total_tokens, 15);
    await assert.rejects(createChatClient({ ...config, model: 'fail' })([]), error => error.message === '模型接口返回 HTTP 401');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
