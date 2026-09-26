// AC-9: a driver whose `send` throws synchronously or rejects still resolves through `notify`, with a
// failed delivery — `notify` itself never rejects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

test('AC-9: a synchronously-throwing driver resolves to a failed, non-empty-error delivery', async () => {
  const { notify } = await import(path.join(REPO, 'substrate', 'notify.js'))
  const record = { id: 'r1-spec_gate', gate: 'spec_gate' }
  const throwingDriver = { name: 'throws-sync', send: () => { throw new Error('boom sync') } }

  const delivery = await notify(record, { env: {}, driver: throwingDriver })
  assert.equal(delivery.attempted, true)
  assert.equal(delivery.ok, false)
  assert.equal(typeof delivery.error, 'string')
  assert.ok(delivery.error.length > 0)
})

test('AC-9: a rejecting driver resolves to a failed, non-empty-error delivery — notify never rejects', async () => {
  const { notify } = await import(path.join(REPO, 'substrate', 'notify.js'))
  const record = { id: 'r1-spec_gate', gate: 'spec_gate' }
  const rejectingDriver = { name: 'rejects', send: async () => { throw new Error('boom async') } }

  await assert.doesNotReject(async () => {
    const delivery = await notify(record, { env: {}, driver: rejectingDriver })
    assert.equal(delivery.attempted, true)
    assert.equal(delivery.ok, false)
    assert.equal(typeof delivery.error, 'string')
    assert.ok(delivery.error.length > 0)
  })
})
