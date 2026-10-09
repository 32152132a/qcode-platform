import { createHash } from 'node:crypto';
import { now, id, text, integer, quotas, fail, audit, resolveModel, publicUser } from './domain.js';
import { departmentConsumption, permissions } from './policy.js';
export const clientVersion = '0.3.0';
const defaults = { organizationName: 'QCode', supportMessage: '遇到问题请联系管理员', minimumClientVersion: '0.3.0', autoUpdate: false, maxActiveRequests: 64, auditRetentionDays: 180 };
export const settingsFor = state => ({ ...defaults, ...state.settings });
export const assignedSkills = (state, user) => state.skills.filter(s => s.active && (!s.department_ids.length || s.department_ids.includes(user.department_id)));
function validateDepartmentReferences(state, body) {
  if (body.modelId != null && !state.models.some(m => m.id === body.modelId && m.active)) fail(400, 'INVALID_MODEL', '请选择启用的模型');
  if (body.keyId != null && !state.keys.some(k => k.id === body.keyId && k.active)) fail(400, 'INVALID_KEY', '请选择启用的 Key');
}
export function registerEnterpriseRoutes(app, { db, config, auth, cancelRequests }) {
  app.get('/client/config', auth, (req, res) => {
    const state = db.read(), model = resolveModel(state, req.user), settings = settingsFor(state);
    if (!model?.active) fail(503, 'MODEL_UNAVAILABLE', '尚未分配启用的模型');
    res.json({ model: model.public_name, contextWindow: model.context_window || 131072, maxOutputTokens: model.max_output_tokens,
      maxTokensField: model.max_tokens_field || 'max_tokens', minimumClientVersion: settings.minimumClientVersion,
      organizationName: settings.organizationName, supportMessage: settings.supportMessage, autoUpdate: settings.autoUpdate,
      skillsRevision: createHash('sha256').update(JSON.stringify(assignedSkills(state, req.user).map(s => [s.id,s.revision]))).digest('hex'), user: publicUser(state, req.user, config.timezone) });
  });
  app.get('/client/skills', auth, (req, res) => res.json({ skills: assignedSkills(db.read(), req.user).map(s => ({ id: s.id, name: s.name, description: s.description, revision: s.revision, files: s.files })) }));
  app.get('/admin/departments', (_req, res) => {
    const state = db.read();
    res.json(state.departments.map(d => ({ ...d, members: state.users.filter(u => u.department_id === d.id).length, used: departmentConsumption(state, d, config.timezone) })));
  });
  function saveDepartment(state, body, actor, existing) {
    validateDepartmentReferences(state, body);
    const name = text(body.name, '部门名称', 80);
    if (state.departments.some(d => d.id !== existing?.id && d.name === name)) fail(409, 'DEPARTMENT_EXISTS', '部门名称已存在');
    if (actor.role !== 'admin' && body.keyId !== undefined && body.keyId !== (existing?.key_id || null)) fail(403, 'KEY_ADMIN_REQUIRED', '只有管理员可以配置部门 Key');
    const department = { ...existing, id: existing?.id || id(), name, active: body.active !== false, model_id: body.modelId ?? null,
      key_id: body.keyId ?? existing?.key_id ?? null, quotas: quotas(body.quotas), user_quotas: quotas(body.userQuotas), created_at: existing?.created_at || now() };
    if (existing) Object.assign(existing, department); else state.departments.push(department);
    for (const user of state.users.filter(u => u.department_id === department.id)) user.department = department.name;
    audit(state, actor, existing ? 'department.update' : 'department.create', department.id);
    return department;
  }
  app.post('/admin/departments', (req, res) => res.status(201).json(db.transaction(state => saveDepartment(state, req.body || {}, req.user))));
  app.put('/admin/departments/:id', (req, res) => {
    const result = db.transaction(state => {
      const department = state.departments.find(d => d.id === req.params.id);
      if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
      return saveDepartment(state, req.body || {}, req.user, department);
    });
    if (!result.active) for (const user of db.read().users.filter(u => u.department_id === result.id)) cancelRequests(user.id, 'DEPARTMENT_DISABLED');
    res.json(result);
  });
  app.post('/admin/departments/:id/reset-quota', (req, res) => {
    db.transaction(state => {
      const department = state.departments.find(d => d.id === req.params.id);
      if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
      if (state.requests.some(r => r.department_id === department.id && r.status === 'pending')) fail(409, 'REQUEST_IN_PROGRESS', '请等待本部门进行中的请求完成');
      department.quota_reset_at = now(); audit(state, req.user, 'department.quota.reset', department.id);
    }); res.json({ ok: true });
  });
  app.delete('/admin/departments/:id', (req, res) => {
    db.transaction(state => {
      if (!state.departments.some(d => d.id === req.params.id)) fail(404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
      if (state.users.some(u => u.department_id === req.params.id) || state.skills.some(s => s.department_ids.includes(req.params.id))) fail(409, 'DEPARTMENT_IN_USE', '请先移出成员并调整关联的 Skill');
      state.departments = state.departments.filter(d => d.id !== req.params.id); audit(state, req.user, 'department.delete', req.params.id);
    }); res.json({ ok: true });
  });
  app.get('/admin/skills', (_req, res) => res.json(db.read().skills));
  function saveSkill(state, body, actor, existing) {
    const name = text(body.name, 'Skill 名称', 64);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(400, 'INVALID_SKILL_NAME', 'Skill 名称只能使用小写字母、数字和短横线，并以字母开头');
    if (state.skills.some(s => s.name === name && s.id !== existing?.id)) fail(409, 'SKILL_EXISTS', 'Skill 名称已存在');
    const description = text(body.description, 'Skill 描述', 500), content = text(body.content, 'Skill 内容', 256000);
    const departmentIds = body.departmentIds || [];
    if (!Array.isArray(departmentIds) || departmentIds.some(value => !state.departments.some(d => d.id === value))) fail(400, 'INVALID_DEPARTMENT', 'Skill 部门配置无效');
    const extraFiles = body.files || {};
    if (typeof extraFiles !== 'object' || Array.isArray(extraFiles) || Object.keys(extraFiles).length > 30) fail(400, 'INVALID_SKILL_FILES', '附加文件最多 30 个');
    const files = { 'SKILL.md': `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${content}\n` };
    for (const [filename, value] of Object.entries(extraFiles)) {
      if (filename === 'SKILL.md' || !/^[a-zA-Z0-9_./-]+$/.test(filename) || filename.startsWith('/') || filename.split('/').some(part => !part || part === '.' || part === '..' || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) || typeof value !== 'string') fail(400, 'INVALID_SKILL_FILE', '附加文件路径或内容无效');
      if (Object.keys(files).some(other => other.toLowerCase() === filename.toLowerCase() || other.startsWith(filename + '/') || filename.startsWith(other + '/'))) fail(400, 'INVALID_SKILL_FILE', '附加文件路径冲突');
      files[filename] = value;
    }
    if (Buffer.byteLength(JSON.stringify(files)) > 1024 * 1024) fail(400, 'SKILL_TOO_LARGE', '每个 Skill 文件总大小上限为 1 MB');
    const skill = { id: existing?.id || id(), name, description, content, files, active: body.active !== false, department_ids: [...new Set(departmentIds)],
      revision: createHash('sha256').update(JSON.stringify(files)).digest('hex'), created_at: existing?.created_at || now(), updated_at: now() };
    if (existing) Object.assign(existing, skill); else state.skills.push(skill);
    audit(state, actor, existing ? 'skill.update' : 'skill.create', skill.id); return skill;
  }
  app.post('/admin/skills', (req, res) => res.status(201).json(db.transaction(state => saveSkill(state, req.body || {}, req.user))));
  app.put('/admin/skills/:id', (req, res) => res.json(db.transaction(state => {
    const skill = state.skills.find(s => s.id === req.params.id);
    if (!skill) fail(404, 'SKILL_NOT_FOUND', 'Skill 不存在');
    return saveSkill(state, req.body || {}, req.user, skill);
  })));
  app.delete('/admin/skills/:id', (req, res) => {
    db.transaction(state => { if (!state.skills.some(s => s.id === req.params.id)) fail(404, 'SKILL_NOT_FOUND', 'Skill 不存在'); state.skills = state.skills.filter(s => s.id !== req.params.id); audit(state, req.user, 'skill.delete', req.params.id); }); res.json({ ok: true });
  });
  app.get('/admin/settings', (_req, res) => res.json(settingsFor(db.read())));
  app.put('/admin/settings', (req, res) => res.json(db.transaction(state => {
    const body = req.body || {}, current = settingsFor(state);
    if (body.organizationName !== undefined) current.organizationName = text(body.organizationName, '组织名称', 80);
    if (body.supportMessage !== undefined) current.supportMessage = text(body.supportMessage, '支持提示', 500);
    if (body.minimumClientVersion !== undefined) {
      if (!/^\d+\.\d+\.\d+$/.test(body.minimumClientVersion)) fail(400, 'INVALID_VERSION', '客户端版本必须为 x.y.z');
      current.minimumClientVersion = body.minimumClientVersion;
    }
    if (body.autoUpdate !== undefined) { if (typeof body.autoUpdate !== 'boolean') fail(400, 'INVALID_FIELD', 'autoUpdate 必须为布尔值'); current.autoUpdate = body.autoUpdate; }
    if (body.maxActiveRequests !== undefined) { current.maxActiveRequests = integer(body.maxActiveRequests, '并发请求数', 1000); if (!current.maxActiveRequests) fail(400, 'INVALID_FIELD', '并发数至少为 1'); }
    if (body.auditRetentionDays !== undefined) current.auditRetentionDays = integer(body.auditRetentionDays, '日志保留天数', 3650);
    state.settings = current; audit(state, req.user, 'settings.update', 'system'); return current;
  })));
  app.get('/admin/users/:id/sessions', (req, res) => {
    const state = db.read(), user = state.users.find(u => u.id === Number(req.params.id));
    if (!user) fail(404, 'USER_NOT_FOUND', '用户不存在');
    if (user.role === 'admin' && req.user.role !== 'admin') fail(403, 'ADMIN_PROTECTED', '仅管理员可以查看管理员会话');
    res.json(state.tokens.filter(t => t.user_id === user.id && (t.refresh_expires_at || t.expires_at) > now()).map(t => ({ id: t.id || t.token_hash.slice(0,12), device: t.device || '旧客户端', created_at: t.created_at, expires_at: t.refresh_expires_at || t.expires_at })));
  });
  app.delete('/admin/users/:id/sessions/:sessionId', (req, res) => {
    db.transaction(state => { state.tokens = state.tokens.filter(t => !(t.user_id === Number(req.params.id) && (t.id || t.token_hash.slice(0,12)) === req.params.sessionId)); audit(state, req.user, 'session.revoke', req.params.sessionId); });
    cancelRequests(Number(req.params.id), 'SESSION_REVOKED', req.params.sessionId); res.json({ ok: true });
  });
}
