import { initializeSelects } from './ui-select.js';
'use strict';
import { renderKnowledge } from './knowledge-ui.js';
import { openModelEditor, modelCards } from './model-ui.js';
import { renderEnterprise } from './enterprise-ui.js';
import { importUsersCsv, downloadText } from './csv.js';
import { renderUsage } from './usage-ui.js';
const usageStyles=document.createElement('link');usageStyles.rel='stylesheet';usageStyles.href='/usage.css';document.head.append(usageStyles);
initializeSelects();
const $ = id => document.getElementById(id);
let token = '', refreshToken = '', refreshing, section = 'overview', currentUser;
const labels = { overview: '工作台概览', users: '用户管理', departments: '部门管理', keys: 'Key 管理', models: '模型配置', skills: '共享 Skill', usage: '用量统计', requests: '请求日志', audits: '操作审计', settings: '系统设置', system: '系统状态', knowledge: '知识库' };
const symbols = ['◈','◇','▦','⌘','◉','▤','▥','≡','✓','⚙','⊙'];
const can = permission => currentUser?.permissions?.includes(permission) || false;
const quotaLabels = { totalTokens: '总 Token 额度', totalRequests: '总请求额度', dailyTokens: '每日 Token', dailyRequests: '每日请求', monthlyTokens: '每月 Token', monthlyRequests: '每月请求' };
const logFilters={requests:{offset:0},audits:{offset:0}};
const usageFilters={};
const showLogin = () => { $('login-error').textContent = ''; if (!$('login-panel').open) $('login-panel').showModal(); };
$('admin-login-trigger').onclick = showLogin;
$('close-login').onclick = () => $('login-panel').close();
function saveSession(result) { token = result.token; refreshToken = result.refreshToken; currentUser = result.user; sessionStorage.setItem('qcode.session', JSON.stringify(result)); }
async function renew() {
  if (!refreshing) refreshing = (async () => {
    const response = await fetch('/auth/refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({refreshToken}) });
    const data = await response.json(); if(!response.ok) { signOut(); throw new Error('会话已失效，请重新登录'); } saveSession(data);
  })();
  try { await refreshing; } finally { refreshing = null; }
}
async function api(path, method = 'GET', data, retry = true) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if(response.status === 401 && refreshToken && retry && path !== '/auth/login') { await renew(); return api(path,method,data,false); }
  if (!response.ok) {
    if (response.status === 401 && token) signOut();
    throw new Error(`${result.error?.message || '请求失败'} (${result.error?.code || response.status})`);
  }
  return result;
}
function notice(error) { $('message').dataset.error = 'true'; $('message').textContent = error.message || String(error); }
function button(label, action, secondary = true) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
  if (secondary) node.className = 'secondary';
  node.addEventListener('click', async () => { node.disabled = true; try { await action(); } catch (error) { notice(error); } finally { node.disabled = false; } });
  return node;
}
function table(headers, rows) {
  const wrapper = document.createElement('div'); wrapper.className = 'table-wrap';
  if (!rows.length) { wrapper.textContent = '暂无记录'; wrapper.className = 'empty'; return wrapper; }
  const grid = document.createElement('table'), head = document.createElement('thead'), row = document.createElement('tr');
  for (const title of headers) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; row.append(cell); }
  head.append(row); grid.append(head);
  const body = document.createElement('tbody');
  for (const values of rows) {
    const tr = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); if (value instanceof Node) td.append(value); else td.textContent = value ?? '—'; tr.append(td); }
    body.append(tr);
  }
  grid.append(body); wrapper.append(grid); return wrapper;
}
const date = value => value ? new Date(value).toLocaleString() : '—';
function actions(...nodes) { const div = document.createElement('div'); div.className = 'actions'; div.append(...nodes); return div; }
function edit(title, fields, save) {
  $('editor-title').textContent = title; $('fields').replaceChildren(); $('editor-error').textContent = '';
  for (const field of fields) {
    if(field.group) { const heading=document.createElement('h3');heading.textContent=field.group;$('fields').append(heading); }
    const label = document.createElement('label'); label.textContent = field.label;
    if(field.wide || field.type === 'textarea') label.className='wide';
    const input = document.createElement(field.options ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
    input.name = field.name;
    input.setAttribute('aria-label',field.label);
    if (field.options) for (const [value, name] of field.options) { const option = document.createElement('option'); option.value = value; option.textContent = name; input.append(option); }
    else if (input.tagName === 'INPUT') { input.type = field.type || 'text'; if (field.type === 'number') { input.min = field.min ?? '0'; input.step = field.step || '1'; } }
    if(field.multiple){input.multiple=true;for(const option of input.options)option.selected=field.value.includes(option.value);}else input.value = field.value ?? '';
    input.required = field.required !== false && !field.options?.some(([value]) => value === '');
    label.append(input); $('fields').append(label);
  }
  $('editor-form').onsubmit = async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try { const form=new FormData(event.target),values=Object.fromEntries(form);for(const field of fields)if(field.multiple)values[field.name]=form.getAll(field.name);await save(values); $('editor').close(); $('message').dataset.error = 'false'; $('message').textContent = '已保存'; await load(); }
    catch (error) { $('editor-error').textContent=error.message; } finally { submit.disabled = false; }
  };
  $('editor').showModal();
}
$('cancel').onclick = () => $('editor').close();
function signOut() { token = ''; refreshToken = ''; currentUser = null; sessionStorage.removeItem('qcode.session'); $('console').hidden = true; $('public-site').hidden = false; if ($('login-panel').open) $('login-panel').close(); $('identity').replaceChildren(); $('tabs').replaceChildren(); }
function showWorkspace() {
  if ($('login-panel').open) $('login-panel').close();$('public-site').hidden=true;$('console').hidden=false;
  $('identity').replaceChildren(document.createTextNode(currentUser.username+' '),button('修改密码',()=>edit('修改自己的密码',[{name:'currentPassword',label:'当前密码',type:'password'},{name:'password',label:'新密码（至少 10 位）',type:'password'}],async data=>{await api('/auth/password','POST',data);signOut();})),button('退出',async()=>{await api('/auth/logout','POST');signOut();}));
  $('tabs').replaceChildren();
  for(const [index,[key,label]] of Object.entries(labels).entries()){
    if(!can(`${key==='overview'?'usage':key}:read`))continue;
    const tab=button(label,async()=>{section=key;await load();});tab.className='';tab.dataset.section=key;tab.replaceChildren();const icon=document.createElement('span');icon.className='nav-symbol';icon.textContent=symbols[index]||'▤';icon.setAttribute('aria-hidden','true');tab.append(icon,document.createTextNode(label));$('tabs').append(tab);
  }
}
$('toggle-password').onclick = () => {
  const input = $('login-password'), show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggle-password').setAttribute('aria-pressed', String(show));
  $('toggle-password').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
};
$('login-form').onsubmit = async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true;
  $('login-error').textContent = '';
  try {
    const result = await api('/auth/login', 'POST', {...Object.fromEntries(new FormData(event.target)),device:'管理工作台'}); saveSession(result);
    if (!result.user.permissions.length) { await api('/auth/logout', 'POST'); signOut(); showLogin(); throw new Error('员工账号请通过 QCode 客户端使用'); }
    event.target.reset(); $('login-password').type='password'; $('toggle-password').setAttribute('aria-pressed','false'); $('toggle-password').setAttribute('aria-label','显示密码'); $('message').textContent = ''; showWorkspace();
    await load();
  } catch (error) { $('login-error').textContent = error.message || String(error); } finally { submit.disabled = false; }
};
async function userEditor(user) {
  const [keys, models, departments] = await Promise.all([can('keys:read')?api('/admin/keys'):[],can('models:read')?api('/admin/models'):[],api('/admin/departments')]);
  const fields = [{ name: 'username', label: '用户名', value: user?.username }];
  if (!user) fields.push({ name: 'password', label: '初始密码（至少 10 位）', type: 'password' });
  fields.push({ name: 'departmentId', label: '部门', options:[['','未分组'],...departments.map(d=>[d.id,d.name])], value:user?.department_id },
    { name: 'modelId', label: '默认模型（不限制其他模型）', options: [['', '使用默认模型'], ...models.map(m => [m.id, m.name])], value: user?.model_id },
    { name: 'sessionLimit', label: '并发登录数（修改后撤销所有登录）', type: 'number', min: 1, value: user?.session_limit || 1 },
    { name: 'maxConcurrentRequests', label:'同时请求数量',type:'number',min:1,value:user?.max_concurrent_requests||1 },
    { name:'quotaMode',label:'配额来源',options:[['custom','使用个人配额'],['department','继承部门成员配额']],value:user?.quota_mode||'custom' });
  if(can('keys:read'))fields.push({ name: 'keyId', label: '分配 Key', options: [['', '继承部门或模型默认 Key / 回收个人 Key'], ...keys.map(k => [k.id, `${k.name} · ${k.suffix}${k.active ? '' : '（已禁用）'}`])], value: user?.key_id });
  if(currentUser.role==='admin')fields.push({name:'role',label:'账号角色',options:[['user','员工'],['operator','运营管理员'],['auditor','只读审计员'],['admin','系统管理员']],value:user?.role||'user'});
  for (const [name, label] of Object.entries(quotaLabels)) fields.push({ name, label: label + '（0 为不限）', type: 'number', value: user?.quotas[name] || 0 });
  edit(user ? `编辑 ${user.username}` : '创建用户', fields, async data => {
    const body = { username: data.username, departmentId: data.departmentId||null, modelId: data.modelId || null,quotaMode:data.quotaMode,maxConcurrentRequests:Number(data.maxConcurrentRequests),
      quotas: Object.fromEntries(Object.keys(quotaLabels).map(k => [k, Number(data[k])])) };
    if (!user || Number(data.sessionLimit) !== user.session_limit) body.sessionLimit = Number(data.sessionLimit);
    if(can('keys:read'))body.keyId=data.keyId||null;
    if(currentUser.role==='admin')body.role=data.role;
    if (!user) Object.assign(body, { username: data.username, password: data.password });
    await api(user ? `/admin/users/${user.id}` : '/admin/users', user ? 'PATCH' : 'POST', body);
  });
}
async function modelEditor(model) {
  const keys = await api('/admin/keys');
  openModelEditor({ model, keys, api, onSaved: async () => { $('message').dataset.error='false';$('message').textContent='配置已保存，请验证后分配给用户或部门';await load(); } });
}
async function testModel(model) {
  try {
    if (model.provider!=='ollama'&&!model.key_id) throw Error('请先在模型配置中选择默认 Key，再测试模型');
    if (!confirm(model.provider==='ollama'?'将发送一次简短文本请求，验证本地模型聊天连通性；不验证工具调用。继续？':'将测试流式工具调用及工具结果回传，产生少量真实用量。继续？')) return;
    const result=await api(`/admin/models/${model.id}/check`,'POST',{});
    await load();$('message').dataset.error=String(!['verified','connected'].includes(result.status));
    $('message').textContent=result.status==='verified'?(result.message||'流式输出、工具调用和结果回传验证通过。还需用员工客户端测试真实项目。'):result.message||'模型验证未通过';
  } catch(error) { notice(error); }
}
async function load() {
  if (!token) return;
  const active = section;
  $('section-title').textContent = labels[active]; $('section-note').textContent = ''; $('actions').replaceChildren(button('刷新', load)); $('content').textContent = '加载中…';
  [...$('tabs').children].forEach(node => node.setAttribute('aria-current', node.dataset.section === active ? 'page' : 'false'));
  $('toolbar').replaceChildren();
  const query=logFilters[active]?`?${new URLSearchParams({...logFilters[active],limit:25})}`:['usage','overview'].includes(active)?`?${new URLSearchParams(usageFilters)}`:'';
  const data = await api(`/admin/${active==='overview'?'usage':active}${query}`);
  if (section !== active || !token) return;
  if(active==='knowledge'){ $('section-note').textContent='手动上传团队资料，通过共享 Skill 提供给员工 AI，关键词检索无需向量服务。';renderKnowledge({data,api,load,can,notice});return; }
  $('content').replaceChildren();
  if(['usage','overview'].includes(active)){
    $('section-note').textContent=`统计时区：${data.timezone}`;
    renderUsage(data,{content:$('content'),toolbar:$('toolbar'),filters:usageFilters,load,notice,table});return;
  }
  if(renderEnterprise(active,data,{content:$('content'),toolbar:$('actions'),actions,api,button,table,edit,load,can,quotaLabels}))return;
  if(['users','keys','models'].includes(active)){const search=document.createElement('input');search.placeholder='搜索当前列表';search.setAttribute('aria-label','搜索当前列表');search.oninput=()=>{for(const row of $('content').querySelectorAll('tbody tr,.model-card'))row.hidden=!row.textContent.toLowerCase().includes(search.value.toLowerCase());};$('toolbar').append(search);}
  if (active === 'users') {
    $('section-note').textContent = '禁用、重置密码和撤销登录会立即阻止旧 Token 的后续请求。额度为 0 表示不限。';
    if(can('users:write'))$('actions').append(button('创建用户', () => userEditor(), false),button('导入 CSV',async()=>{await importUsersCsv(api);await load();}),button('下载模板',()=>downloadText('员工导入模板.csv','\uFEFF用户名,初始密码,部门\r\n')));
    $('content').append(table(['用户 / 部门', '角色', '状态', 'Key', '创建时间', '最后登录', '会话', '已计费 / 总额度', '操作'], data.map(u => [
      `${u.username} / ${u.department || '未分组'}`, u.role, u.is_active ? '启用' : '禁用', u.key_suffix, date(u.created_at), date(u.last_login_at), `${u.active_sessions}/${u.session_limit}`,
      `${u.used.totalTokens}/${u.effective_quotas.totalTokens || '不限'}`, (!can('users:write')||(u.role==='admin'&&currentUser.role!=='admin'))?'只读':actions(button('编辑', () => userEditor(u)),
        button('重置密码', () => edit(`重置 ${u.username} 密码`, [{ name: 'password', label: '新密码（至少 10 位）', type: 'password' }], d => api(`/admin/users/${u.id}/password`, 'POST', d))),
        button('撤销登录', async () => { if (confirm(`撤销 ${u.username} 的全部登录？`)) { await api(`/admin/users/${u.id}/revoke-sessions`, 'POST'); await load(); } }),
        button('恢复额度', async () => { if (confirm('重置该用户所有周期额度？历史用量仍保留。')) { await api(`/admin/users/${u.id}/reset-quota`, 'POST'); await load(); } }),
        ...(u.role === 'admin' ? [] : [button(u.is_active ? '禁用' : '启用', async () => { await api(`/admin/users/${u.id}/status`, 'PATCH', { isActive: !u.is_active }); await load(); }),
          button('删除', async () => { if (confirm(`删除 ${u.username}？请求与审计历史保留。`)) { await api(`/admin/users/${u.id}`, 'DELETE'); await load(); } })]))])));
  } else if (active === 'keys') {
    $('section-note').textContent = 'Key 加密保存，仅显示末四位。连通检查访问默认模型的 /models，不代表有生成权限或剩余余额。';
    $('actions').append(button('添加 Key', () => edit('添加 Key', [{ name: 'name', label: '名称' }, { name: 'apiKey', label: '真实 Key', type: 'password' }], d => api('/admin/keys', 'POST', d)), false),
      button('批量导入', () => edit('批量导入 Key', [{ name: 'keys', label: '每行一个 Key（导入后自动清空）', type: 'textarea' }], d => api('/admin/keys', 'POST', { keys: d.keys.split(/\r?\n/).map(k => k.trim()).filter(Boolean).map((apiKey, i) => ({ name: `Imported ${i + 1}`, apiKey })) }))));
    $('content').append(table(['名称', '末四位', '状态', '检查结果', '分配用户', '请求数', '操作'], data.map(k => [k.name, k.suffix, k.active ? '启用' : '禁用', k.health, k.assigned_users.join(', '), k.requests,
      actions(button('检查', async () => { const result = await api(`/admin/keys/${k.id}/check`, 'POST'); $('message').dataset.error = 'false'; $('message').textContent = result.health === 'reachable' ? '服务已连通；生成权限仍需实际请求验证。' : result.health; await load(); }),
        button('替换', () => edit('替换 Key（保留现有分配）', [{ name: 'apiKey', label: '新 Key', type: 'password' }], d => api(`/admin/keys/${k.id}`, 'PATCH', d))),
        button(k.active ? '禁用' : '启用', async () => { await api(`/admin/keys/${k.id}`, 'PATCH', { active: !k.active }); await load(); }),
        button('删除', async () => { if (confirm('删除未分配的 Key？')) { await api(`/admin/keys/${k.id}`, 'DELETE'); await load(); } }))])));
  } else if (active === 'models') {
    if(can('models:write'))$('actions').append(button('添加模型', () => modelEditor(), false));
    $('section-note').textContent = '添加服务 → 选择 Key 和上游模型 → 验证并启用。所有用户均可选择；用户和部门默认模型仅决定初始选择。员工重启客户端即可获取新增模型，无需重新安装。';
    const keys=can('keys:read')?await api('/admin/keys'):[];
    $('content').append(modelCards(data,keys,{edit:modelEditor,test:testModel,writable:can('models:write')}));
  } else if (active === 'requests' || active === 'audits') {
    const filter=logFilters[active];$('section-note').textContent = `共 ${data.total} 条，当前第 ${Math.floor(filter.offset/25)+1} 页。记录不包含提示词、代码内容或真实 Key。`;
    for(const [key,title] of [['from','开始日期'],['to','结束日期'],['search','关键词']]){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type=key==='search'?'search':'date';input.value=filter[key]||'';input.onchange=()=>{filter[key]=input.value;filter.offset=0;load().catch(notice);};label.append(input);$('toolbar').append(label);}
    $('actions').append(button('上一页',async()=>{filter.offset=Math.max(0,filter.offset-25);await load();}),button('下一页',async()=>{if(filter.offset+25<data.total){filter.offset+=25;await load();}}),button('导出 CSV',async()=>{await renew();const response=await fetch(`/admin/${active}/export?${new URLSearchParams(filter)}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok){const result=await response.json();throw new Error(result.error.message);}downloadText(`qcode-${active}.csv`,await response.text());}));
    $('content').append(active === 'requests' ? table(['时间', '用户', '模型', '输入', '输出', '总量', '计费', '来源', '耗时 ms', '状态', '错误'], data.items.map(r => [date(r.started_at), r.username, r.model, r.input_tokens, r.output_tokens, r.total_tokens, r.charged_tokens, r.usage_source, r.duration_ms, r.status, r.error_code]))
      : table(['时间', '操作人', '动作', '对象'], data.items.map(r => [date(r.time), r.actor, r.action, r.target])));
  } else {
    $('section-note').textContent = '网关运行状态。部署凭据保存在服务器私有环境配置中。';
    $('content').append(table(['配置', '值'], Object.entries(data)));
  }
}
// Keep the session current; refresh credentials can renew an expired access token.
setInterval(async () => { if (!token) return; try { await renew(); } catch (error) { notice(error); } }, 10 * 60 * 1000);
$('editor').addEventListener('close', () => { $('fields').replaceChildren(); });
try { const saved=JSON.parse(sessionStorage.getItem('qcode.session')||'null');if(saved){saveSession(saved);await renew();showWorkspace();await load();} }catch(error){signOut();notice(error);}
