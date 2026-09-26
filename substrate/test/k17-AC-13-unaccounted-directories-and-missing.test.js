// AC-13: unaccountedTestFiles, called with tests_found entries carrying directories
// ('substrate/test/a.test.js') and landed/skipped entries as bare basenames, accounts for the
// directory-carrying entries; a genuinely missing file ('stray.test.js' in tests_found only) is still
// returned; and requested_paths [] still returns [] regardless of tests_found (existing AC-21 behaviour).
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

test('AC-13: directory-carrying tests_found entries are accounted for; a genuinely missing file is still reported', () => {
  const { unaccountedTestFiles } = loadAllFixLoopDecisions()
  const result = unaccountedTestFiles({
    requested_paths: ['.artifacts/tests/t1/a.test.js'],
    tests_found: ['substrate/test/a.test.js', 'stray.test.js'],
    tests_landed: ['a.test.js'],
    tests_skipped: [],
  })
  assert.deepEqual(result, ['stray.test.js'])
})

test('AC-13: requested_paths [] returns [] regardless of tests_found', () => {
  const { unaccountedTestFiles } = loadAllFixLoopDecisions()
  const result = unaccountedTestFiles({
    requested_paths: [],
    tests_found: ['substrate/test/a.test.js', 'stray.test.js'],
    tests_landed: [],
    tests_skipped: [],
  })
  assert.deepEqual(result, [])
})
