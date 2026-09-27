// spec-wi-c15-c12-c14-line-guards AC-11. Written from the Spec only.
//
// "verifyGate with gate_id 'k8-spec_gate' ... read has option 'reject', or status 'open', or found false, or
// gate 'some_other_gate' (not equal to gate_id), or is null/undefined, with or without an id problem as well
// ... It returns ok: false, retry: false, and failed_fields includes every field that failed (for a null
// read, at least 'found'). The check fails closed."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopFunctions } from './k21-fixloop-all.js'

const GATE_ID = 'k8-spec_gate'
const GOOD = { found: true, status: 'decided', gate: 'spec_gate', option: 'approve', id: GATE_ID }

test('AC-11: option "reject" fails closed (ok:false, retry:false)', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({ gate_id: GATE_ID, read: { ...GOOD, option: 'reject' } })
  assert.equal(result.ok, false)
  assert.equal(result.retry, false)
  assert.ok(result.failed_fields.includes('option'))
})

test('AC-11: status "open" fails closed (ok:false, retry:false)', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({ gate_id: GATE_ID, read: { ...GOOD, status: 'open' } })
  assert.equal(result.ok, false)
  assert.equal(result.retry, false)
  assert.ok(result.failed_fields.includes('status'))
})

test('AC-11: found false fails closed (ok:false, retry:false)', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({ gate_id: GATE_ID, read: { ...GOOD, found: false } })
  assert.equal(result.ok, false)
  assert.equal(result.retry, false)
  assert.ok(result.failed_fields.includes('found'))
})

test('AC-11: a gate value that is neither "spec_gate" nor equal to gate_id fails closed, not retryable', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({ gate_id: GATE_ID, read: { ...GOOD, gate: 'some_other_gate' } })
  assert.equal(result.ok, false)
  assert.equal(result.retry, false)
  assert.ok(result.failed_fields.includes('gate'))
})

test('AC-11: a null or undefined read fails closed, with failed_fields including at least "found"', () => {
  const { fns } = loadAllFixLoopFunctions()
  for (const read of [null, undefined]) {
    const result = fns.verifyGate({ gate_id: GATE_ID, read })
    assert.equal(result.ok, false, `expected ok:false for read=${read}`)
    assert.equal(result.retry, false, `expected retry:false for read=${read}`)
    assert.ok(result.failed_fields.includes('found'), `expected failed_fields to include "found" for read=${read}`)
  }
})

test('AC-11: an unretryable failure (e.g. wrong option) combined with an id problem is still not retryable', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({ gate_id: GATE_ID, read: { ...GOOD, option: 'reject', id: 'wrong-id' } })
  assert.equal(result.ok, false)
  assert.equal(result.retry, false)
  assert.ok(result.failed_fields.includes('option'))
})
