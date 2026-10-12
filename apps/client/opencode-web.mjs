import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

function equal(left, right) {
  const a = Buffer.from(left || ''), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Browser credentials are distinct from gateway/model credentials and live only for this process.
export async function startOpenCodeWeb({ upstreamUrl, username, password, workdir }) {
  const upstream = new URL(upstreamUrl);
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' || upstream.username || upstream.password) throw new Error('Invalid local Web upstream');
  if (!username || !password) throw new Error('Missing local Web credentials');
  const workspacePath = '/' + Buffer.from(workdir).toString('base64url') + '/session';
  const bootstrapToken = randomBytes(32).toString('base64url');
  const sessionToken = randomBytes(32).toString('base64url');
  const cookieName = 'qcode_' + randomBytes(8).toString('hex');
  const authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const sockets = new Set();
  let origin;
  function local(request) {
    return request.headers.host === new URL(origin).host && (!request.headers.origin || request.headers.origin === origin);
  }
  function authenticated(request) {
    const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='));
    return equal(cookie?.slice(cookieName.length + 1), sessionToken);
  }
  function headers(request) {
    const result = { ...request.headers, host: upstream.host, authorization };
    delete result.cookie; delete result.origin;
    delete result['proxy-authorization']; delete result['forwarded'];
    delete result['x-forwarded-host']; delete result['x-forwarded-for'];
    if (!result['x-opencode-directory']) result['x-opencode-directory'] = encodeURIComponent(workdir);
    return result;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!local(req)) return res.writeHead(403).end('Forbidden');
    if (req.url === '/_qcode/start' && req.method === 'GET') {
      const nonce = randomBytes(16).toString('base64');
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'`);
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>QCode</title><p id="status">正在打开 QCode…</p><script nonce="${nonce}">
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
fetch('/_qcode/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:token}).then(response=>{if(!response.ok)throw new Error();location.replace(${JSON.stringify(workspacePath)})}).catch(()=>document.getElementById('status').textContent='访问链接已失效，请重新启动 QCode。');
</script></html>`);
    }
    if (req.url === '/_qcode/login' && req.method === 'POST') {
      if (req.headers.origin !== origin) return res.writeHead(403).end('Forbidden');
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) { res.writeHead(413).end(); return; }
        }
      } catch { return res.destroy(); }
      if (!equal(body, bootstrapToken)) return res.writeHead(401).end('Unauthorized');
      res.setHeader('Set-Cookie', `${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
      return res.writeHead(204).end();
    }
    if (!authenticated(req)) return res.writeHead(401).end('Open QCode using its local launch link.');
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) return res.writeHead(400).end();
    const forward = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: headers(req) }, response => {
      const responseHeaders = { ...response.headers };
      delete responseHeaders['set-cookie']; delete responseHeaders['www-authenticate'];
      delete responseHeaders['access-control-allow-origin']; delete responseHeaders['access-control-allow-credentials'];
      res.writeHead(response.statusCode, responseHeaders);
      response.on('error', () => res.destroy()); response.pipe(res);
    });
    forward.on('error', () => { if (!res.headersSent) res.writeHead(502).end('QCode local service unavailable'); else res.destroy(); });
    req.on('aborted', () => forward.destroy());
    res.on('close', () => forward.destroy());
    req.pipe(forward);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (!local(req) || !authenticated(req) || !req.url?.startsWith('/') || req.url.startsWith('//')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const forward = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, headers: headers(req) });
    forward.on('upgrade', (response, peer, upstreamHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
      for (const [key, value] of Object.entries(response.headers)) if (!['set-cookie', 'www-authenticate'].includes(key)) socket.write(`${key}: ${value}\r\n`);
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy());
      socket.on('close', () => peer.destroy()); peer.on('close', () => socket.destroy());
      socket.pipe(peer); peer.pipe(socket);
    });
    forward.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    forward.on('error', () => socket.destroy());
    socket.on('close', () => forward.destroy()); forward.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, url: `${origin}/_qcode/start#${bootstrapToken}`,
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }),
  };
}

export function waitForOpenCodeServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('QCode Web startup timed out')), 30000);
    function finish(error, url) {
      clearTimeout(timer); child.stdout.off('data', onData); child.off('exit', onExit); child.off('error', onError);
      if (error) reject(error); else resolve(url);
    }
    function onData(chunk) {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) finish(null, match[1]);
    }
    function onExit() { finish(new Error('QCode Web exited before becoming ready')); }
    function onError(error) { finish(error); }
    child.stdout.on('data', onData); child.once('exit', onExit); child.once('error', onError);
  });
}
