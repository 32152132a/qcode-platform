import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Keep upstream unchanged: pass managed configuration and per-account storage at launch.
export function prepareOpenCodeLaunch({ entry, mode = 'tui', home, config, baseUrl, token, environment = process.env }) {
  if (!['tui', 'web'].includes(mode)) throw new Error('Unsupported OpenCode mode');
  if (!fs.existsSync(entry)) throw new Error('OpenCode executable is missing; set QCODE_OPENCODE_ENTRY.');
  const address = new URL(baseUrl);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.username || address.password) {
    throw new Error('OpenCode must connect through the local QCode bridge.');
  }
  if (!token) throw new Error('Missing local bridge credential');
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (/^OPENCODE_/i.test(key) || /^(OPENAI_API_KEY|DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|QCODE_TOKEN)$/i.test(key)) delete env[key];
  }
  for (const [key, folder] of Object.entries({ XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state', TEMP: 'tmp', TMP: 'tmp' })) {
    env[key] = path.join(home, folder);
    fs.mkdirSync(env[key], { recursive: true });
  }
  const managed = {
    enabled_providers: ['qcode'], model: 'qcode/qcode-model', small_model: 'qcode/qcode-model',
    autoupdate: false, share: 'disabled', skills: { paths: [path.join(home, 'skills')] },
    provider: { qcode: {
      name: 'QCode', npm: '@ai-sdk/openai-compatible', env: [],
      options: { baseURL: baseUrl, apiKey: token },
      models: { 'qcode-model': {
        name: config.model, tool_call: true, attachment: false, reasoning: false,
        limit: { context: config.contextWindow, output: config.maxOutputTokens },
      } },
    } },
  };
  Object.assign(env, {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(managed),
    OPENCODE_CONFIG_DIR: path.join(home, 'config', 'opencode'),
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_TERMINAL_TITLE: 'true',
  });
  if (mode === 'web') {
    env.OPENCODE_SERVER_USERNAME = 'qcode';
    env.OPENCODE_SERVER_PASSWORD = randomBytes(32).toString('base64url');
  }
  return { command: path.resolve(entry), args: mode === 'web' ? ['serve', '--hostname', '127.0.0.1', '--port', '0', '--no-mdns'] : [], env };
}
