import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './gateway.test.js';
import { ensureDemoUser } from '../src/auth.js';

test('demo is opt-in and never publishes normal administrator credentials', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/auth/demo')).body, { enabled: false });
  assert(!f.db.read().users.some(user => user.role === 'demo'));
});

test('demo can query real records and open forms but cannot mutate or consume models', async t => {
  const f = await fixture(t, { demoEnabled: true });
  const config = (await f.request('/auth/demo')).body;
  assert.deepEqual(config, { enabled: true, username: 'demo', password: 'qcode-demo-2026' });
  const login = (await f.request('/auth/login', 'POST', config)).body;
  assert.equal(login.user.role, 'demo');
  assert(login.user.permissions.length > 0);
  assert(login.user.permissions.every(permission => permission.endsWith(':read')));
  for (const route of ['/admin/users', '/admin/models', '/admin/keys', '/admin/departments', '/admin/skills', '/admin/knowledge', '/admin/usage', '/admin/requests', '/admin/audits', '/admin/system', '/admin/settings'])
    assert.equal((await f.request(route, 'GET', undefined, login.token)).status, 200, route);
  const keys = (await f.request('/admin/keys', 'GET', undefined, login.token)).body;
  assert(!JSON.stringify(keys).includes('secret-provider-key'));
  const before = JSON.stringify(f.db.read());
  for (const [route, method] of [['/admin/users', 'POST'], ['/admin/users/1', 'PATCH'], ['/admin/users/1', 'DELETE'], ['/admin/users/1/password', 'POST'], ['/admin/users/import', 'POST'], ['/admin/settings', 'PUT'], ['/admin/models', 'POST'], ['/admin/models/missing/check', 'POST'], ['/admin/models/sources/missing/sync', 'POST'], ['/admin/keys/missing/check', 'POST'], ['/admin/knowledge', 'POST'], ['/auth/password', 'POST'], ['/v1/chat/completions', 'POST']]) {
    const result = await f.request(route, method, {}, login.token);
    assert.equal(result.status, 403, route);
    assert.equal(result.body.error.code, 'DEMO_READ_ONLY', route);
  }
  assert.equal(JSON.stringify(f.db.read()), before);
  assert.equal(f.calls(), 0);
  const renewed = await f.request('/auth/refresh', 'POST', { refreshToken: login.refreshToken });
  assert.equal(renewed.status, 200);
  assert.equal((await f.request('/auth/logout', 'POST', {}, renewed.body.token)).status, 200);
});

test('demo provisioning is repeatable, cannot reuse an administrator or be promoted, and can be disabled', async t => {
  const f = await fixture(t, { demoEnabled: true });
  const count = f.db.read().users.length;
  ensureDemoUser(f.db, { demoEnabled: true, demoUsername: 'demo', demoPassword: 'qcode-demo-2026' });
  assert.equal(f.db.read().users.length, count);
  assert.throws(() => ensureDemoUser(f.db, { demoEnabled: true, demoUsername: 'admin', demoPassword: 'qcode-demo-2026' }), /conflicts/);
  const demo = f.db.read().users.find(user => user.role === 'demo');
  assert.equal((await f.request('/admin/users/' + demo.id, 'PATCH', { role: 'admin' }, f.admin)).status, 403);
  const first = (await f.request('/auth/login', 'POST', { username: 'demo', password: 'qcode-demo-2026' })).body;
  await f.request('/auth/login', 'POST', { username: 'demo', password: 'qcode-demo-2026' });
  assert.equal((await f.request('/auth/me', 'GET', undefined, first.token)).status, 200);
  assert.equal((await f.request('/admin/users/' + demo.id + '/status', 'PATCH', { isActive: false }, f.admin)).status, 200);
  assert.deepEqual((await f.request('/auth/demo')).body, { enabled: false });
  assert.equal((await f.request('/auth/me', 'GET', undefined, first.token)).status, 401);
  const ordinary = await f.create();
  assert.equal(ordinary.role, 'user');
});

test('business transport is POST only and old clients must upgrade', async t => {
 const f=await fixture(t),headers={'Content-Type':'application/json',Authorization:'Bearer '+f.admin};
 for(const [method,route] of [['GET','/auth/me'],['GET','/client/config'],['GET','/admin/users'],['POST','/admin/users'],['PATCH','/admin/users/123']]){
  const response=await fetch(f.url+route,{method,headers,...(method==='GET'?{}:{body:'{}'})});
  assert.equal(response.status,426,method+' '+route);
 }
 assert.equal((await fetch(f.url+'/admin/users/list',{method:'POST',headers,body:'{}'})).status,200);
 assert.equal((await fetch(f.url+'/auth/me',{method:'POST',headers,body:'{}'})).status,200);
 assert.equal((await fetch(f.url+'/health')).status,200);
 assert.equal((await fetch(f.url+'/v1/models',{headers})).status,200);
});
