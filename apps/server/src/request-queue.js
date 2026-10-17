import { fail } from './domain.js'

// Waiting requests reserve neither tokens nor a model connection.
export function createAccountRequestQueue({
  canStart,
  waitMs = 15000,
  maxPerUser = 4,
  maxTotal = 64,
}) {
  const queues = new Map()
  let timer,
    pumping = false
  function remove(job) {
    const queue = queues.get(job.userId)
    if (!queue) return
    const index = queue.indexOf(job)
    if (index >= 0) queue.splice(index, 1)
    if (!queue.length) queues.delete(job.userId)
    job.res.off('close', job.cancel)
    if (!queues.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
  function pump() {
    if (pumping) return
    pumping = true
    try {
      for (const queue of queues.values()) {
        while (queue.length) {
          const job = queue[0]
          if (job.res.destroyed) {
            remove(job)
            job.resolve()
            continue
          }
          if (Date.now() - job.started >= waitMs) {
            remove(job)
            job.res.setHeader('Retry-After', '1')
            try {
              fail(429, 'REQUEST_QUEUE_TIMEOUT', '账号请求较多，排队等待超时，请稍后重试')
            } catch (error) {
              job.reject(error)
            }
            continue
          }
          let ready
          try {
            ready = canStart(job.userId)
          } catch (error) {
            remove(job)
            job.reject(error)
            continue
          }
          if (!ready) break
          remove(job)
          try {
            // Run synchronously through quota reservation before checking the next slot.
            Promise.resolve(job.run()).then(job.resolve, job.reject).finally(pump)
          } catch (error) {
            job.reject(error)
          }
        }
      }
    } finally {
      pumping = false
    }
  }
  return function run(req, res, operation) {
    const userId = req.user.id
    const queue = queues.get(userId) || []
    if (!queue.length && canStart(userId)) return operation()
    const total = [...queues.values()].reduce((count, items) => count + items.length, 0)
    if (queue.length >= maxPerUser || total >= maxTotal) {
      res.setHeader('Retry-After', '1')
      fail(429, 'REQUEST_QUEUE_FULL', '等待请求较多，请稍后重试')
    }
    return new Promise((resolve, reject) => {
      const job = {
        userId,
        res,
        run: operation,
        resolve,
        reject,
        started: Date.now(),
        cancel: undefined,
      }
      job.cancel = () => {
        remove(job)
        resolve()
      }
      res.on('close', job.cancel)
      queue.push(job)
      queues.set(userId, queue)
      if (!timer) {
        timer = setInterval(pump, 50)
        timer.unref()
      }
      pump()
    })
  }
}
