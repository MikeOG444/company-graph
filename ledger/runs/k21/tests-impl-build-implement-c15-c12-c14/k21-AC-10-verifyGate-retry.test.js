// spec-wi-c15-c12-c14-line-guards AC-10. Written from the Spec only.
//
// "verifyGate with gate_id 'k8-spec_gate' ... read is { found: true, status: 'decided', gate: 'k8-spec_gate',
// option: 'approve', id: 'k8-spec_gate' } (the k9 miscopy), or the same read with id missing or id wrong but
// gate 'spec_gate' ... It returns ok: false, retry: true, and failed_fields names exactly the failing fields
// among 'gate' and 'id'."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopFunctions } from './extract-fixloop.js'

const GATE_ID = 'k8-spec_gate'

test('AC-10: the k9 miscopy (gate holds the gate_id instead of "spec_gate") is ok:false, retry:true, failed_fields ["gate"]', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({
    gate_id: GATE_ID,
    read: { found: true, status: 'decided', gate: GATE_ID, option: 'approve', id: GATE_ID },
  })
  assert.equal(result.ok, false)
  assert.equal(result.retry, true)
  assert.deepEqual(result.failed_fields.slice().sort(), ['gate'])
})

test('AC-10: a missing id, gate otherwise correct, is ok:false, retry:true, failed_fields ["id"]', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({
    gate_id: GATE_ID,
    read: { found: true, status: 'decided', gate: 'spec_gate', option: 'approve' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.retry, true)
  assert.deepEqual(result.failed_fields.slice().sort(), ['id'])
})

test('AC-10: a wrong id, gate otherwise correct, is ok:false, retry:true, failed_fields ["id"]', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({
    gate_id: GATE_ID,
    read: { found: true, status: 'decided', gate: 'spec_gate', option: 'approve', id: 'wrong-id' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.retry, true)
  assert.deepEqual(result.failed_fields.slice().sort(), ['id'])
})

test('AC-10: both gate and id wrong (double miscopy), found/status/option correct, is ok:false, retry:true, failed_fields ["gate","id"]', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({
    gate_id: GATE_ID,
    read: { found: true, status: 'decided', gate: GATE_ID, option: 'approve', id: 'wrong-id' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.retry, true)
  assert.deepEqual(result.failed_fields.slice().sort(), ['gate', 'id'])
})
