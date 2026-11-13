import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './gateway.test.js';

test('registration requires a free default plan and cannot select privileges or paid terms', async t => {
  const f = await fixture(t);
  const register = body => f.request('/auth/register', 'POST', { username: 'new-user', password: 'user-password', ...body });
  assert.equal((await register()).body.error.code, 'REGISTRATION_UNAVAILABLE');
  assert.equal(f.db.read().users.length, 1);
  const model = f.db.read().models[0];
  const plan = (await f.request('/admin/plans', 'POST', { name: '基础版', price: 0, durationDays: 30,
    level: 0, isDefault: true, modelIds: [model.id], creditAmount: 5 }, f.admin)).body;
  assert.equal((await register({ role: 'admin', quotas: { totalTokens: null }, sessionLimit: 20, planId: 'paid-plan' })).status, 201);
  const user = f.db.read().users.find(user => user.username === 'new-user');
  assert.equal(user.role, 'user'); assert.deepEqual(user.quotas, {});
  assert.notEqual(user.password_hash, 'user-password');
  const subscription = f.db.read().subscriptions.find(item => item.user_id === user.id);
  assert.equal(subscription.plan_id, plan.id); assert.equal(subscription.terms.credit_limit_micros, 5000000);
  const login = await f.request('/auth/login', 'POST', { username: 'new-user', password: 'user-password' });
  assert.equal(login.status, 200);
  assert.equal((await f.request('/admin/users', 'GET', undefined, login.body.token)).status, 403);
  assert.equal((await register({ username: 'NEW-USER' })).status, 409);
  assert.equal((await register({ username: 'demo' })).status, 409);
  assert.equal((await register({ username: 'other', password: 'short' })).status, 400);
  assert.equal((await register({ username: 'last-user' })).status, 429);
});

test('inactive or paid default plans do not grant unrestricted registration', async t => {
  const f = await fixture(t);
  f.db.transaction(state => state.plans.push({ id: 'invalid-default', is_default: true, active: true, price_cents: 100 }));
  const result = await f.request('/auth/register', 'POST', { username: 'new-user', password: 'user-password' });
  assert.equal(result.status, 503); assert.equal(f.db.read().users.length, 1);
});
