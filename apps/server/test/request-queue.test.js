import { EventEmitter } from 'node:events'
import { createAccountRequestQueue } from '../src/request-queue.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './gateway.test.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
test('overlapping account requests queue instead of exceeding the configured concurrency', async (t) => {
  const f = await fixture(t)
  await f.create()
  const token = await f.login()
  const results = await Promise.all([
    f.chat(token, { testCase: 'slow' }),
    f.chat(token, { testCase: 'slow' }),
    f.chat(token),
  ])
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200, 200]
  )
  assert.equal(f.calls(), 3)
  assert(f.db.read().requests.every((request) => request.status === 'success'))
})
test('queue timeout does not reserve quota or send an upstream request', async (t) => {
  const f = await fixture(t, { requestQueueWaitMs: 20 })
  await f.create()
  const token = await f.login()
  const first = f.chat(token, { testCase: 'slow' })
  await wait(10)
  const second = await f.chat(token)
  assert.equal(second.status, 429)
  assert.equal(second.body.error.code, 'REQUEST_QUEUE_TIMEOUT')
  await first
  assert.equal(f.calls(), 1)
  assert.equal(f.db.read().requests.length, 1)
})
test('queued requests revalidate revoked sessions and disabled accounts before model access', async (t) => {
  for (const action of ['disable', 'logout']) {
    const f = await fixture(t)
    const user = await f.create()
    const token = await f.login()
    const first = f.chat(token, { testCase: 'slow' })
    await wait(10)
    const queued = f.chat(token)
    await wait(10)
    if (action === 'disable')
      await f.request('/admin/users/' + user.id + '/status', 'PATCH', { isActive: false }, f.admin)
    else await f.request('/auth/logout', 'POST', {}, token)
    const result = await queued
    assert([401, 403].includes(result.status), JSON.stringify(result))
    await first
    assert.equal(f.calls(), 1)
  }
})
test('a cancelled queued HTTP request never reaches the model', async (t) => {
  const f = await fixture(t)
  await f.create()
  const token = await f.login()
  const first = f.chat(token, { testCase: 'slow' })
  await wait(10)
  const controller = new AbortController()
  const second = fetch(f.url + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({
      model: 'qcode-model',
      messages: [{ role: 'user', content: 'cancel me' }],
    }),
    signal: controller.signal,
  }).catch(() => null)
  await wait(10)
  controller.abort()
  await second
  await first
  await wait(80)
  assert.equal(f.calls(), 1)
  assert.equal(f.db.read().requests.length, 1)
})

test('bounded queues reject overflow and remove cancelled waiters without running them', async () => {
  const queue = createAccountRequestQueue({
    canStart: () => false,
    waitMs: 1000,
    maxPerUser: 2,
    maxTotal: 3,
  })
  const responses = [],
    pending = []
  for (const userId of [1, 1, 2]) {
    const res = new EventEmitter()
    res.setHeader = () => {}
    responses.push(res)
    pending.push(
      queue({ user: { id: userId } }, res, () => assert.fail('cancelled job must not run'))
    )
  }
  for (const userId of [1, 3]) {
    const res = new EventEmitter()
    res.setHeader = () => {}
    assert.throws(
      () => queue({ user: { id: userId } }, res, () => {}),
      (error) => error.code === 'REQUEST_QUEUE_FULL'
    )
  }
  for (const res of responses) res.emit('close')
  await Promise.all(pending)
  assert(responses.every((res) => res.listenerCount('close') === 0))
})
