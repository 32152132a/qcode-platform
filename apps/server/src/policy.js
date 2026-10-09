import { fail, quotaNames, now, period } from './domain.js';
export const rolePermissions = {
  admin: ['users:read','users:write','keys:read','keys:write','models:read','models:write','departments:read','departments:write','skills:read','skills:write','usage:read','requests:read','audits:read','system:read','settings:read','settings:write'],
  operator: ['users:read','users:write','models:read','departments:read','departments:write','skills:read','skills:write','usage:read','requests:read','system:read'],
  auditor: ['users:read','departments:read','usage:read','requests:read','audits:read','system:read'],
  user: [],
};
export const permissions = user => Object.hasOwn(rolePermissions, user.role) ? rolePermissions[user.role] : [];
export const departmentFor = (state, user) => state.departments.find(d => d.id === user.department_id);
export function effectiveQuotas(state, user) {
  return user.quota_mode === 'department' ? departmentFor(state, user)?.user_quotas || user.quotas : user.quotas;
}
export function effectiveKey(state, user) {
  const keyId = user.key_id || departmentFor(state, user)?.key_id;
  return state.keys.find(k => k.id === keyId);
}
export function departmentConsumption(state, department, timezone, timestamp = now()) {
  const day = period(timestamp, timezone), used = Object.fromEntries(quotaNames.map(name => [name, 0]));
  for (const row of state.requests) {
    if (row.department_id !== department.id || (department.quota_reset_at && row.started_at < department.quota_reset_at)) continue;
    const tokens = row.charged_tokens ?? row.reserved_tokens ?? 0;
    used.totalTokens += tokens; used.totalRequests++;
    const requestDay = period(row.started_at, timezone);
    if (requestDay === day) { used.dailyTokens += tokens; used.dailyRequests++; }
    if (requestDay.slice(0,7) === day.slice(0,7)) { used.monthlyTokens += tokens; used.monthlyRequests++; }
  }
  return used;
}
export function checkQuota(limits, used, reserved, label = '') {
  for (const name of quotaNames) {
    const required = name.endsWith('Tokens') ? reserved : 1;
    if (limits[name] && used[name] + required > limits[name]) fail(429, 'QUOTA_EXCEEDED', `${label}${name} 额度不足，请降低输出上限或联系管理员`);
  }
}
export function protectAdministrator(state, user, actor, changingRole = false) {
  if (user.role === 'admin' && actor.role !== 'admin') fail(403, 'ADMIN_PROTECTED', '仅管理员可以修改管理员账号');
  if (changingRole && user.role === 'admin' && !state.users.some(u => u.id !== user.id && u.role === 'admin' && u.is_active)) fail(409, 'LAST_ADMIN', '必须保留至少一个启用的管理员');
}
export function adminPermission(db, config) {
  return (req, _res, next) => {
    const resource = req.path.split('/')[1], action = ['GET','HEAD'].includes(req.method) ? 'read' : 'write';
    if (!permissions(req.user).includes(`${resource}:${action}`)) fail(403, 'PERMISSION_DENIED', '当前角色没有此操作权限');
    const address = req.ip?.replace(/^::ffff:/, '');
    if (config.adminAddresses.length && !config.adminAddresses.includes(address)) fail(403, 'ADMIN_SOURCE_DENIED', '此来源地址不允许访问后台');
    const userId = resource === 'users' && req.path.match(/^\/users\/(\d+)(?:\/|$)/)?.[1];
    if (userId && action === 'write') {
      const user = db.read().users.find(u => u.id === Number(userId));
      if (user) protectAdministrator(db.read(), user, req.user);
    }
    // Operators can manage ordinary staff but cannot grant roles or access secrets.
    if (req.user.role !== 'admin' && (req.body?.role || req.body?.users?.some?.(u => u?.role && u.role !== 'user'))) fail(403, 'ROLE_ADMIN_REQUIRED', '只有管理员可以设置角色');
    next();
  };
}
