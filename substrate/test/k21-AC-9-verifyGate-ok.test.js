// spec-wi-c15-c12-c14-line-guards AC-9. Written from the Spec only.
//
// "verifyGate from the extracted block with gate_id 'k8-spec_gate' ... read = { found: true,
// status: 'decided', gate: 'spec_gate', option: 'approve', id: 'k8-spec_gate' } ... It returns ok: true,
// retry: false, failed_fields: []."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopFunctions } from './k21-fixloop-all.js'

test('AC-9: verifyGate returns ok true, retry false, failed_fields [] for a fully matching read', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.verifyGate({
    gate_id: 'k8-spec_gate',
    read: { found: true, status: 'decided', gate: 'spec_gate', option: 'approve', id: 'k8-spec_gate' },
  })
  assert.equal(result.ok, true)
  assert.equal(result.retry, false)
  assert.deepEqual(result.failed_fields, [])
})
