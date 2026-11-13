export const maxActiveRequests = 64;
import { subscriptionFor } from './entitlements.js';
import { sourceKey } from './key-pool.js';
import { fail, quotaNames, resolveModel } from './domain.js';
export const rolePermissions = {
  admin: ['plans:read','plans:write','feedback:read','feedback:write','knowledge:read','knowledge:write','users:read','users:write','keys:read','keys:write','models:read','models:write','skills:read','skills:write','usage:read','requests:read','audits:read'],
  user: [],
};
rolePermissions.demo = rolePermissions.admin.filter(permission => permission.endsWith(':read') && !permission.startsWith('feedback:'));
rolePermissions.admin.push('plugins:read', 'plugins:write');
export const permissions = user => Object.hasOwn(rolePermissions, user.role) ? rolePermissions[user.role] : [];
export function effectiveQuotas(state, user) {
  const subscription = subscriptionFor(state, user);
  if (subscription) return {};
  return Object.fromEntries(Object.entries(user.quotas).map(([name, limit]) => [name, limit || null]));
}
export function effectiveKey(state, user, model = resolveModel(state, user)) {
  const source = state.settings.modelSources.find(source => source.id === model?.source_id);
  if (source) return sourceKey(state, source);
  // A model-bound credential must not be replaced with another provider's user key.
  const keyId = model?.key_id || user.key_id;
  return state.keys.find(key => key.id === keyId);
}
export function checkQuota(limits, used, reserved, label = '') {
  for (const name of quotaNames) {
    const required = name.endsWith('Tokens') ? reserved : 1;
    if (limits[name] !== null && limits[name] !== undefined && used[name] + required > limits[name]) fail(429, 'QUOTA_EXCEEDED', `${label}${name} 额度不足，请降低输出上限或联系管理员`);
  }
}
export function adminPermission(config) {
  return (req, _res, next) => {
    const resource = req.path.split('/')[1], action = req.businessOperation?.[3] || (['GET','HEAD'].includes(req.method) ? 'read' : 'write');
    if (!permissions(req.user).includes(`${resource}:${action}`)) fail(403, 'PERMISSION_DENIED', '当前角色没有此操作权限');
    const address = req.ip?.replace(/^::ffff:/, '');
    if (config.adminAddresses.length && !config.adminAddresses.includes(address)) fail(403, 'ADMIN_SOURCE_DENIED', '此来源地址不允许访问后台');
    next();
  };
}
