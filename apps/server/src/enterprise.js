import { createHash } from 'node:crypto';
import { knowledgeSkill } from './knowledge-runtime.js';
import { configuredVisionModel } from './model-sources.js';
import { modelPresentation } from './model-presentation.js';
import { now, id, text, integer, fail, audit, availableModels, publicUser } from './domain.js';
export const clientVersion = '0.3.0';
const defaults = { organizationName: 'QCode', supportMessage: '遇到问题请联系管理员', minimumClientVersion: '0.3.0', maxActiveRequests: 64, auditRetentionDays: 180 };
export const settingsFor = state => ({ ...defaults, ...state.settings });
export const assignedSkills = state => [...state.skills.filter(skill => skill.active && skill.kind !== 'knowledge'), knowledgeSkill()];
export function registerEnterpriseRoutes(app, { db, config, auth, cancelRequests }) {
  app.post('/client/config', auth, (req, res) => {
    const state = db.read(), settings = settingsFor(state);
    res.json({
      models: availableModels(state, req.user).map(item => ({ id: item.public_name, name: item.name, ...modelPresentation(item), imageInput: Boolean(item.capabilities?.includes('vision') || configuredVisionModel(state)), contextWindow: item.context_window || 131072, maxOutputTokens: item.max_output_tokens, maxTokensField: item.max_tokens_field || 'max_tokens', toolCall: item.verification?.tools ?? item.provider !== 'ollama' })),
      minimumClientVersion: settings.minimumClientVersion,
      organizationName: settings.organizationName, supportMessage: settings.supportMessage,
      skillsRevision: createHash('sha256').update(JSON.stringify(assignedSkills(state).map(s => [s.id,s.revision]))).digest('hex'), user: publicUser(state, req.user, config.timezone) });
  });
  app.post('/client/skills', auth, (req, res) => res.json({ skills: assignedSkills(db.read()).map(s => ({ id: s.id, name: s.name, kind: 'skill', title: s.name, description: s.description, revision: s.revision, files: s.files })) }));
  app.post('/admin/skills/list', (_req, res) => res.json(db.read().skills.filter(s=>s.kind!=='knowledge')));
  function saveSkill(state, body, actor, existing) {
    const name = text(body.name, 'Skill 名称', 64);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(400, 'INVALID_SKILL_NAME', 'Skill 名称只能使用小写字母、数字和短横线，并以字母开头');
    if (name === knowledgeSkill().name) fail(400, 'SKILL_NAME_RESERVED', '此名称由内置知识库技能使用，请换一个名称');
    if (state.skills.some(s => s.name === name && s.id !== existing?.id)) fail(409, 'SKILL_EXISTS', 'Skill 名称已存在');
    const description = text(body.description, 'Skill 描述', 500), content = text(body.content, 'Skill 内容', 256000);
    const extraFiles = body.files || {};
    if (typeof extraFiles !== 'object' || Array.isArray(extraFiles) || Object.keys(extraFiles).length > 255) fail(400, 'INVALID_SKILL_FILES', '附加文件最多 255 个，含 SKILL.md 共 256 个');
    const files = { 'SKILL.md': `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${content}\n` };
    for (const [filename, value] of Object.entries(extraFiles)) {
      if (filename === 'SKILL.md' || !/^[a-zA-Z0-9_./-]+$/.test(filename) || filename.startsWith('/') || filename.split('/').some(part => !part || part === '.' || part === '..' || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) || typeof value !== 'string') fail(400, 'INVALID_SKILL_FILE', '附加文件路径或内容无效');
      if (Object.keys(files).some(other => other.toLowerCase() === filename.toLowerCase() || other.startsWith(filename + '/') || filename.startsWith(other + '/'))) fail(400, 'INVALID_SKILL_FILE', '附加文件路径冲突');
      files[filename] = value;
    }
    if (Buffer.byteLength(JSON.stringify(files)) > 8 * 1024 * 1024) fail(400, 'SKILL_TOO_LARGE', '每个 Skill 文件总大小上限为 8 MB');
    const skill = { id: existing?.id || id(), name, description, content, files, active: body.active !== false,
      revision: createHash('sha256').update(JSON.stringify(files)).digest('hex'), created_at: existing?.created_at || now(), updated_at: now() };
    if (existing) Object.assign(existing, skill); else state.skills.push(skill);
    audit(state, actor, existing ? 'skill.update' : 'skill.create', skill.id); return skill;
  }
  app.post('/admin/skills/create', (req, res) => res.status(201).json(db.transaction(state => saveSkill(state, req.body || {}, req.user))));
  app.post('/admin/skills/:id/update', (req, res) => res.json(db.transaction(state => {
    const skill = state.skills.find(s => s.id === req.params.id && s.kind!=='knowledge');
    if (!skill) fail(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    return saveSkill(state, req.body || {}, req.user, skill);
  })));
  app.post('/admin/skills/:id/delete', (req, res) => {
    db.transaction(state => { if (!state.skills.some(s => s.id === req.params.id && s.kind!=='knowledge')) fail(404, 'SKILL_NOT_FOUND', 'Skill 不存在'); state.skills = state.skills.filter(s => s.id !== req.params.id); audit(state, req.user, 'skill.delete', req.params.id); }); res.json({ ok: true });
  });
  app.post('/admin/settings/detail', (_req, res) => res.json(settingsFor(db.read())));
  app.post('/admin/settings/update', (req, res) => res.json(db.transaction(state => {
    const body = req.body || {}, current = settingsFor(state);
    if (body.organizationName !== undefined) current.organizationName = text(body.organizationName, '组织名称', 80);
    if (body.supportMessage !== undefined) current.supportMessage = text(body.supportMessage, '支持提示', 500);
    if (body.minimumClientVersion !== undefined) {
      if (!/^\d+\.\d+\.\d+$/.test(body.minimumClientVersion)) fail(400, 'INVALID_VERSION', '客户端版本必须为 x.y.z');
      current.minimumClientVersion = body.minimumClientVersion;
    }
    if (body.maxActiveRequests !== undefined) { current.maxActiveRequests = integer(body.maxActiveRequests, '并发请求数', 1000); if (!current.maxActiveRequests) fail(400, 'INVALID_FIELD', '并发数至少为 1'); }
    if (body.auditRetentionDays !== undefined) current.auditRetentionDays = integer(body.auditRetentionDays, '日志保留天数', 3650);
    state.settings = current; audit(state, req.user, 'settings.update', 'system'); return current;
  })));
  app.post('/admin/users/:id/sessions/list', (req, res) => {
    const state = db.read(), user = state.users.find(u => u.id === Number(req.params.id));
    if (!user) fail(404, 'USER_NOT_FOUND', '用户不存在');
    if (user.role === 'admin' && req.user.role !== 'admin') fail(403, 'ADMIN_PROTECTED', '仅管理员可以查看管理员会话');
    res.json(state.tokens.filter(t => t.user_id === user.id && t.refresh_expires_at > now()).map(t => ({ id: t.id, device: t.device || '未命名设备', created_at: t.created_at, expires_at: t.refresh_expires_at })));
  });
  app.post('/admin/users/:id/sessions/:sessionId/delete', (req, res) => {
    db.transaction(state => { state.tokens = state.tokens.filter(t => !(t.user_id === Number(req.params.id) && t.id === req.params.sessionId)); audit(state, req.user, 'session.revoke', req.params.sessionId); });
    cancelRequests(Number(req.params.id), 'SESSION_REVOKED', req.params.sessionId); res.json({ ok: true });
  });
}
