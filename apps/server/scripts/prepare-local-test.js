// Run manually after stopping the old gateway. Existing environment values are preserved.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
const filename = '.env';
if (fs.existsSync(filename)) {
  const contents = fs.readFileSync(filename, 'utf8');
  if (/^KEY_ENCRYPTION_SECRET=[a-f0-9]{64}\s*$/mi.test(contents)) console.log('Encryption secret already configured; no changes made.');
  else {
    const line = contents.match(/^KEY_ENCRYPTION_SECRET=(.*)$/m);
    if (line && line[1].trim() && !line[1].startsWith('replace-with-')) throw new Error('Existing encryption secret is invalid. Refusing to replace it; verify your protected backup.');
    const setting = `KEY_ENCRYPTION_SECRET=${randomBytes(32).toString('hex')}`;
    const updated = line ? contents.replace(/^KEY_ENCRYPTION_SECRET=.*$/m, setting) : `${contents}\n${setting}\n`;
    fs.writeFileSync(filename, updated, { mode: 0o600 });
    console.log('Added encryption secret to the existing private .env. Back it up before starting the gateway.');
  }
} else {
  const password = randomBytes(18).toString('base64url');
  fs.writeFileSync(filename, `HOST=127.0.0.1\nPORT=3100\nDB_PATH=./data/qcode.sqlite\nKEY_ENCRYPTION_SECRET=${randomBytes(32).toString('hex')}\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${password}\nQUOTA_TIMEZONE=Asia/Shanghai\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env with a random administrator password. Read it locally; add models and keys in the admin page.');
}
