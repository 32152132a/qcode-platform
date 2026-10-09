import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp, readConfig } from '../src/app.js';
import { createDatabase, createVault } from '../src/database.js';
import { createMockModelServer } from './mock-model.js';
const envFile = '.env.demo';
if (!fs.existsSync(envFile)) {
  const password = randomBytes(18).toString('base64url');
  fs.writeFileSync(envFile, [
    'HOST=127.0.0.1', 'PORT=3310', 'DB_PATH=./data/demo.json', `KEY_ENCRYPTION_SECRET=${randomBytes(32).toString('hex')}`,
    'ADMIN_USERNAME=admin', `ADMIN_PASSWORD=${password}`, 'UPSTREAM_BASE_URL=http://127.0.0.1:3320/v1',
    'UPSTREAM_MODEL=mock-model', 'PUBLIC_MODEL=qcode-model', 'UPSTREAM_API_KEY=mock-local-key', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync('.demo-access.txt', `本地演示： http://127.0.0.1:3310\n用户名：admin\n密码：${password}\n此文件包含演示凭据，不要提交或共享。\n`, { mode: 0o600 });
}
// Read only this private demo environment; never connect to the real provider.
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const config = readConfig(env);
if (config.host !== '127.0.0.1' || config.port !== 3310 || config.baseUrl !== 'http://127.0.0.1:3320/v1' || config.dbPath !== './data/demo.json') throw new Error('Demo configuration must use its isolated loopback addresses and demo database');
const db = createDatabase(config.dbPath, { vault: createVault(config.encryptionSecret) });
const mock = createMockModelServer();
const gateway = createApp(config, db).listen(config.port, config.host, () => console.log('Demo: http://127.0.0.1:3310 — credentials are in apps/server/.demo-access.txt'));
mock.listen(3320, '127.0.0.1');
let closing = false;
function close(code = 0) {
  if (closing) return; closing = true;
  gateway.closeAllConnections(); mock.closeAllConnections(); gateway.close(); mock.close(); db.close(); process.exitCode = code;
}
for (const server of [gateway, mock]) server.on('error', error => { console.error(`Demo failed: ${error.code}`); close(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close());
