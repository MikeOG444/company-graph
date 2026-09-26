// AC-14: unlandedRepairs, called with repaired_tests [{ source: 'tests_ref', ref:
// '.artifacts/tests/t1/ci-workflow.test.js' }] and tests_skipped ['ci-workflow.test.js (already exists)'],
// returns a one-element list naming ci-workflow.test.js; existing behaviour (branch-carried
// finding_location repairs excluded, empty inputs return []) is unchanged.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

test('AC-14: a "(already exists)" skip matching a tests_ref repair by basename is reported as unlanded', () => {
  const { unlandedRepairs } = loadAllFixLoopDecisions()
  const result = unlandedRepairs({
    tests_skipped: ['ci-workflow.test.js (already exists)'],
    repaired_tests: [{ source: 'tests_ref', ref: '.artifacts/tests/t1/ci-workflow.test.js' }],
  })
  assert.equal(result.length, 1)
  assert.ok(String(result[0]).includes('ci-workflow.test.js'), 'expected the one result to name ci-workflow.test.js')
})

test('AC-14: a finding_location (branch-carried) repair is still excluded', () => {
  const { unlandedRepairs } = loadAllFixLoopDecisions()
  const result = unlandedRepairs({
    tests_skipped: ['ci-workflow.test.js (already exists)'],
    repaired_tests: [{ source: 'finding_location', ref: 'toy/test/ci-workflow.test.js' }],
  })
  assert.deepEqual(result, [])
})

test('AC-14: empty inputs still return []', () => {
  const { unlandedRepairs } = loadAllFixLoopDecisions()
  assert.deepEqual(unlandedRepairs({ tests_skipped: [], repaired_tests: [] }), [])
  assert.deepEqual(unlandedRepairs({ tests_skipped: undefined, repaired_tests: undefined }), [])
})
