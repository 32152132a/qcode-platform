// Business request contract: operation, resource, POST endpoint, demo access.
export const businessApi = [
  ["GET","/admin/users","/admin/users/list","read"],
  ["POST","/admin/users","/admin/users/create","write"],
  ["POST","/admin/users/import","/admin/users/import","write"],
  ["PATCH","/admin/users/:id","/admin/users/:id/update","write"],
  ["PATCH","/admin/users/:id/status","/admin/users/:id/status","write"],
  ["POST","/admin/users/:id/password","/admin/users/:id/password","write"],
  ["POST","/admin/users/:id/revoke-sessions","/admin/users/:id/revoke-sessions","write"],
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
  ["GET","/admin/system","/admin/system/detail","read"],
  ["GET","/auth/demo","/auth/demo","read"],
  ["POST","/auth/login","/auth/login","session"],
  ["POST","/auth/refresh","/auth/refresh","session"],
  ["GET","/auth/me","/auth/me","read"],
  ["GET","/auth/sessions","/auth/sessions/list","read"],
  ["POST","/auth/logout","/auth/logout","session"],
  ["POST","/auth/password","/auth/password","write"],
  ["GET","/client/config","/client/config","read"],
  ["GET","/client/skills","/client/skills","read"],
  ["GET","/admin/departments","/admin/departments/list","read"],
  ["POST","/admin/departments","/admin/departments/create","write"],
  ["PUT","/admin/departments/:id","/admin/departments/:id/update","write"],
  ["POST","/admin/departments/:id/reset-quota","/admin/departments/:id/reset-quota","write"],
  ["DELETE","/admin/departments/:id","/admin/departments/:id/delete","write"],
  ["GET","/admin/skills","/admin/skills/list","read"],
  ["POST","/admin/skills","/admin/skills/create","write"],
  ["PUT","/admin/skills/:id","/admin/skills/:id/update","write"],
  ["DELETE","/admin/skills/:id","/admin/skills/:id/delete","write"],
  ["GET","/admin/settings","/admin/settings/detail","read"],
  ["PUT","/admin/settings","/admin/settings/update","write"],
  ["GET","/admin/users/:id/sessions","/admin/users/:id/sessions/list","read"],
  ["DELETE","/admin/users/:id/sessions/:sessionId","/admin/users/:id/sessions/:sessionId/delete","write"],
  ["GET","/admin/knowledge","/admin/knowledge/list","read"],
  ["GET","/admin/knowledge/search","/admin/knowledge/search","read"],
  ["GET","/admin/knowledge/:id","/admin/knowledge/:id/detail","read"],
  ["POST","/admin/knowledge","/admin/knowledge/create","write"],
  ["PUT","/admin/knowledge/:id","/admin/knowledge/:id/update","write"],
  ["DELETE","/admin/knowledge/:id","/admin/knowledge/:id/delete","write"],
  ["GET","/client/knowledge/search","/client/knowledge/search","read"],
  ["POST","/admin/models/catalog","/admin/models/catalog","write"],
  ["POST","/admin/models/:id/catalog","/admin/models/:id/catalog","write"],
  ["POST","/admin/models/:id/check","/admin/models/:id/check","write"],
  ["GET","/admin/models/sources","/admin/models/sources/list","read"],
  ["POST","/admin/models/sources","/admin/models/sources/create","write"],
  ["PUT","/admin/models/sources/:id","/admin/models/sources/:id/update","write"],
  ["DELETE","/admin/models/sources/:id","/admin/models/sources/:id/delete","write"],
  ["POST","/admin/models/sources/:id/sync","/admin/models/sources/:id/sync","write"],
  ["POST","/admin/models/sources/:id/import","/admin/models/sources/:id/import","write"],
  ["POST","/admin/models/sources/:id/models","/admin/models/sources/:id/models","write"],
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
