// Business request contract: operation, resource, POST endpoint, demo access.
export const businessApi = [
  ["GET","/admin/plugins","/admin/plugins/list","read"],
  ["POST","/admin/plugins/github","/admin/plugins/github","write"],
  ["GET","/admin/models/embeddings/settings","/admin/models/embeddings/settings/detail","read"],
  ["PUT","/admin/models/embeddings/settings","/admin/models/embeddings/settings/update","write"],
  ["GET","/admin/plans/payment-config","/admin/plans/payment-config/detail","read"],
  ["PUT","/admin/plans/payment-config","/admin/plans/payment-config/update","write"],
  ["GET","/client/billing","/client/billing/detail","read"],
  ["POST","/client/billing/apply","/client/billing/apply","write"],
  ["POST","/client/billing/:id/cancel","/client/billing/:id/cancel","write"],
  ["DELETE","/admin/plans/orders/:id","/admin/plans/orders/:id/delete","write"],
  ["GET","/admin/plans/orders","/admin/plans/orders/list","read"],
  ["GET","/admin/plans/members","/admin/plans/members/list","read"],
  ["POST","/admin/plans/members/:id/reset","/admin/plans/members/:id/reset","write"],
  ["POST","/admin/plans/grants","/admin/plans/grants/create","write"],
  ["POST","/admin/plans/orders/:id/approve","/admin/plans/orders/:id/approve","write"],
  ["POST","/admin/plans/orders/:id/reject","/admin/plans/orders/:id/reject","write"],
  ["GET","/admin/plans","/admin/plans/list","read"],
  ["POST","/admin/plans","/admin/plans/create","write"],
  ["PUT","/admin/plans/:id","/admin/plans/:id/update","write"],
  ["DELETE","/admin/plans/:id","/admin/plans/:id/delete","write"],
  ["GET","/client/feedback","/client/feedback/list","read"],
  ["POST","/client/feedback","/client/feedback/create","write"],
  ["GET","/admin/feedback","/admin/feedback/list","read"],
  ["GET","/admin/feedback/:id","/admin/feedback/:id/detail","read"],
  ["PUT","/admin/feedback/:id","/admin/feedback/:id/update","write"],
  ["DELETE","/admin/feedback/:id","/admin/feedback/:id/delete","write"],
  ["POST","/admin/models/:id/purpose","/admin/models/:id/purpose","write"],
  ["GET","/admin/models/images/settings","/admin/models/images/settings/detail","read"],
  ["PUT","/admin/models/images/settings","/admin/models/images/settings/update","write"],
  ["GET","/client/images/status","/client/images/status","read"],
  ["GET","/admin/users/options","/admin/users/options","read"],
  ["GET","/admin/users","/admin/users/list","read"],
  ["POST","/admin/users","/admin/users/create","write"],
  ["PATCH","/admin/users/:id","/admin/users/:id/update","write"],
  ["PATCH","/admin/users/:id/status","/admin/users/:id/status","write"],
  ["POST","/admin/users/:id/password","/admin/users/:id/password","write"],
  ["POST","/admin/users/:id/reset-quota","/admin/users/:id/reset-quota","write"],
  ["DELETE","/admin/users/:id","/admin/users/:id/delete","write"],
  ["GET","/admin/keys","/admin/keys/list","read"],
  ["POST","/admin/keys","/admin/keys/create","write"],
  ["PATCH","/admin/keys/:id","/admin/keys/:id/update","write"],
  ["DELETE","/admin/keys/:id","/admin/keys/:id/delete","write"],
  ["POST","/admin/keys/:id/check","/admin/keys/:id/check","write"],
  ["GET","/admin/models/ollama-preset","/admin/models/ollama-preset","read"],
  ["GET","/admin/models","/admin/models/list","read"],
  ["POST","/admin/models","/admin/models/create","write"],
  ["PUT","/admin/models/:id","/admin/models/:id/update","write"],
  ["GET","/admin/usage","/admin/usage/query","read"],
  ["GET","/admin/requests","/admin/requests/list","read"],
  ["GET","/admin/audits","/admin/audits/list","read"],
  ["GET","/auth/demo","/auth/demo","read"],
  ["POST","/auth/login","/auth/login","session"],
  ["POST","/auth/register","/auth/register","session"],
  ["POST","/auth/refresh","/auth/refresh","session"],
  ["GET","/auth/me","/auth/me","read"],
  ["POST","/auth/logout","/auth/logout","session"],
  ["POST","/auth/password","/auth/password","write"],
  ["GET","/client/config","/client/config","read"],
  ["GET","/client/skills","/client/skills","read"],
  ["GET","/admin/skills","/admin/skills/list","read"],
  ["POST","/admin/skills","/admin/skills/create","write"],
  ["PUT","/admin/skills/:id","/admin/skills/:id/update","write"],
  ["DELETE","/admin/skills/:id","/admin/skills/:id/delete","write"],
  ["GET","/admin/knowledge","/admin/knowledge/list","read"],
  ["POST","/admin/knowledge/articles/delete/preview","/admin/knowledge/articles/delete/preview","read"],
  ["POST","/admin/knowledge/articles/delete","/admin/knowledge/articles/delete","write"],
  ["POST","/admin/knowledge/articles/export","/admin/knowledge/articles/export","read"],
  ["POST","/admin/knowledge/beautify","/admin/knowledge/beautify","write"],
  ["POST","/admin/knowledge/test","/admin/knowledge/test","write"],
  ["POST","/admin/knowledge/search","/admin/knowledge/search","read"],
  ["POST","/admin/knowledge/upload","/admin/knowledge/upload","write"],
  ["GET","/admin/knowledge/settings","/admin/knowledge/settings/detail","read"],
  ["PUT","/admin/knowledge/settings","/admin/knowledge/settings/update","write"],
  ["POST","/admin/knowledge/publish","/admin/knowledge/publish","write"],
  ["POST","/admin/knowledge/:id/retry","/admin/knowledge/:id/retry","write"],
  ["DELETE","/admin/knowledge/uploads/:id","/admin/knowledge/uploads/:id/delete","write"],
  ["POST","/client/knowledge/catalogue","/client/knowledge/catalogue","read"],
  ["POST","/client/knowledge/read","/client/knowledge/read","read"],
  ["GET","/client/knowledge","/client/knowledge/list","read"],
  ["POST","/client/knowledge/upload","/client/knowledge/upload","write"],
  ["GET","/client/knowledge/shared","/client/knowledge/shared/list","read"],
  ["GET","/client/knowledge/shared/:id","/client/knowledge/shared/:id/detail","read"],
  ["POST","/client/knowledge/:id/download","/client/knowledge/:id/download","read"],
  ["POST","/client/knowledge/:id/received","/client/knowledge/:id/received","write"],
  ["POST","/client/knowledge/:id/retry","/client/knowledge/:id/retry","write"],
  ["DELETE","/client/knowledge/:id","/client/knowledge/:id/delete","write"],
  ["POST","/admin/models/catalog","/admin/models/catalog","write"],
  ["POST","/admin/models/:id/catalog","/admin/models/:id/catalog","write"],
  ["POST","/admin/models/:id/check","/admin/models/:id/check","write"],
  ["GET","/admin/models/sources","/admin/models/sources/list","read"],
  ["POST","/admin/models/sources","/admin/models/sources/create","write"],
  ["PUT","/admin/models/sources/:id","/admin/models/sources/:id/update","write"],
  ["DELETE","/admin/models/sources/:id","/admin/models/sources/:id/delete","write"],
  ["POST","/admin/models/sources/:id/sync","/admin/models/sources/:id/sync","write"],
  ["POST","/admin/models/sources/:id/models","/admin/models/sources/:id/models","write"],
  ["DELETE","/admin/models/sources/:id/models/:modelId","/admin/models/sources/:id/models/:modelId/delete","write"],
  ["PATCH","/admin/models/sources/:id/models/:modelId","/admin/models/sources/:id/models/:modelId/update","write"]
];

function matches(pattern, pathname) {
  return new RegExp('^' + pattern.replace(/:[A-Za-z]+/g, '[^/]+') + '$').test(pathname);
}
export function businessOperation(pathname) { return businessApi.find(row => matches(row[2], pathname)); }
export function businessRequest(resource, operation = 'GET', data) {
  const parsed = new URL(resource, 'http://qcode.local');
  const row = businessApi.find(row => row[0] === operation.toUpperCase() && matches(row[1], parsed.pathname));
  if (!row) {
    if (/^\/(?:admin|auth|client)(?:\/|$)/.test(parsed.pathname) && !/^\/admin\/(?:requests|audits)\/export$/.test(parsed.pathname)) throw new Error('Unknown business operation: ' + operation + ' ' + parsed.pathname);
    return { url: resource, method: operation, data };
  }
  const values = parsed.pathname.split('/');
  const url = row[2].split('/').map((part, index) => part.startsWith(':') ? values[index] : part).join('/');
  return { url, method: 'POST', data: row[3] === 'read' ? { ...Object.fromEntries(parsed.searchParams), ...(data || {}) } : data };
}

export function obsoleteBusinessRequest(method, pathname) {
  return businessApi.some(row => row[0] === method && matches(row[1], pathname) && (method !== 'POST' || row[2] !== pathname));
}
