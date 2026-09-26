// AC-12: unaccountedTestFiles, called with the k15 lander shape (requested_paths non-empty, tests_found
// ['b5-wiring-helpers.js', 'a.test.js', 'b.test.js'], tests_landed ['a.test.js'], tests_skipped
// ['b5-wiring-helpers.js (already exists)', 'b.test.js (already exists)']), returns [].
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

test('AC-12: a lander reporting "(already exists)" skips no longer produces unaccounted files', () => {
  const { unaccountedTestFiles } = loadAllFixLoopDecisions()
  const result = unaccountedTestFiles({
    requested_paths: ['.artifacts/tests/t1/whatever.test.js'],
    tests_found: ['b5-wiring-helpers.js', 'a.test.js', 'b.test.js'],
    tests_landed: ['a.test.js'],
    tests_skipped: ['b5-wiring-helpers.js (already exists)', 'b.test.js (already exists)'],
  })
  assert.deepEqual(result, [])
})
