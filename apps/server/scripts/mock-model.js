import http from 'node:http';
export function createMockModelServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer mock-local-key') { res.writeHead(401).end('{"error":"Mock key required"}'); return; }
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); return; }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4 * 1024 * 1024) throw new Error('Too large'); }
      const body = JSON.parse(raw), usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };
      const content = '这是 QCode 本地模拟模型，仅用于验证登录、转发、流式响应和用量统计，不具备真实编程能力。';
      if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }));
    } catch { res.writeHead(400).end('{"error":"Invalid mock request"}'); }
  });
}
