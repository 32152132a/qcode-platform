import { createHash } from 'node:crypto';
import { knowledgeSkill } from './knowledge-runtime.js';
import { configuredVisionModel } from './model-sources.js';
import { modelPresentation } from './model-presentation.js';
import { subscriptionFor } from './entitlements.js';
import { now, id, text, integer, fail, audit, availableModels, publicUser } from './domain.js';
export const assignedSkills = state => [...state.skills.filter(skill => skill.active && skill.kind !== 'knowledge'), knowledgeSkill()];
export function registerEnterpriseRoutes(app, { db, config, auth }) {
  const githubEnabled = state => state.settings.githubPluginEnabled === true;
  app.post('/admin/plugins/list', (_req, res) => res.json({ githubEnabled: githubEnabled(db.read()) }));
  app.post('/admin/plugins/github', (req, res) => res.json(db.transaction(state => {
    if (typeof req.body?.enabled !== 'boolean') fail(400, 'INVALID_FIELD', '请选择插件启用状态');
    state.settings.githubPluginEnabled = req.body.enabled;
    return { githubEnabled: githubEnabled(state) };
  })));
  app.post('/client/config', auth, (req, res) => {
    const state = db.read();
    const models = availableModels(state, req.user);
    const subscription = subscriptionFor(state, req.user);
    if (subscription) {
      const rank = new Map(subscription.terms.model_ids.map((id, index) => [id, index]));
      models.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    }
    // Estimate the same request for every model: 10,000 uncached input and 1,000 output tokens.
    const costs = new Map(models.flatMap(model => {
      const prices = [model.input_price, model.cached_input_price, model.output_price];
      if (model.pricing_known !== true || model.currency !== 'CNY' ||
          prices.some(price => !Number.isFinite(price) || price < 0)) return [];
      const estimated = model.input_price * 10 + model.output_price;
      return estimated > 0 || prices.every(price => price === 0) ? [[model.id, estimated]] : [];
    }));
    const baseline = models[0];
    const baselineCost = costs.get(baseline?.id);
    res.json({
      githubPluginEnabled: req.user.role !== 'demo' && githubEnabled(state),
      defaultModelId: subscription ? models[0]?.public_name ?? null : null,
      models: models.map(item => ({ id: item.public_name, name: item.name, ...modelPresentation(item),
        ...(costs.get(item.id) === 0 ? { usageRate: 0 } : baselineCost && costs.has(item.id)
          ? { usageRate: costs.get(item.id) / baselineCost, usageBaseline: baseline.name || baseline.public_name } : {}),
        imageInput: Boolean(item.capabilities?.includes('vision') || configuredVisionModel(state)), contextWindow: item.context_window || 131072, maxTokensField: item.max_tokens_field || 'max_tokens', toolCall: item.verification?.tools ?? item.provider !== 'ollama' })),
      productName: 'QCode',
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
}
