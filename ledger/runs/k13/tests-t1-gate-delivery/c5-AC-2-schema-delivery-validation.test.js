// AC-2: malformed `delivery` objects are rejected; a well-formed one is accepted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'

const baseRecord = () => ({
  id: 'r1-spec_gate',
  gate: 'spec_gate',
  run_id: 'r1',
  workflow: 'build-spec',
  status: 'open',
  opened_at: '2026-09-11T03:00:00.000Z',
  options: ['approve', 'revise'],
  provenance: {
    node: 'spec_gate', executor: 'ai_agent', method: 'hitl', run_id: 'r1',
    created_at: '2026-09-11T03:00:00.000Z',
  },
})

test('AC-2: a delivery object missing `ok` is rejected', async () => {
  const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
  const rec = { ...baseRecord(), delivery: { attempted: true, channel: 'phone', at: '2026-09-11T03:04:00.000Z' } }
  assert.equal(validate('GateRecord', rec).ok, false)
})

test('AC-2: a delivery.attempted that is a string instead of a boolean is rejected', async () => {
  const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
  const rec = {
    ...baseRecord(),
    delivery: { attempted: 'yes', ok: true, channel: 'phone', at: '2026-09-11T03:04:00.000Z' },
  }
  assert.equal(validate('GateRecord', rec).ok, false)
})

test('AC-2: a delivery object with an unknown extra property is rejected', async () => {
  const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
  const rec = {
    ...baseRecord(),
    delivery: {
      attempted: true, ok: true, channel: 'phone', at: '2026-09-11T03:04:00.000Z',
      unexpected_field: 'nope',
    },
  }
  assert.equal(validate('GateRecord', rec).ok, false)
})

test('AC-2: a well-formed delivery object is accepted', async () => {
  const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
  const rec = {
    ...baseRecord(),
    delivery: { attempted: true, ok: true, channel: 'phone', at: '2026-09-11T03:04:00.000Z' },
  }
  const { ok, errors } = validate('GateRecord', rec)
  assert.ok(ok, JSON.stringify(errors))
})
