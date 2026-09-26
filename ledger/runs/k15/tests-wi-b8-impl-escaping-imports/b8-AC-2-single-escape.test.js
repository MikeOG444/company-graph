// spec-wi-b8-tests-run-the-task-code AC-2. Written from the Spec only.
//
// "escapingImports loaded from the sentinel block. It is called with { tests_ref: '.artifacts/tests/t1',
// imports: [{ file: '.artifacts/tests/t1/x.test.js', specifier: '../../../substrate/test/helpers.js' }] }.
// It returns an array of exactly one entry, with file '.artifacts/tests/t1/x.test.js' and specifier
// '../../../substrate/test/helpers.js'."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEscapingImports } from './b8-escaping-imports-helpers.js'

test('AC-2: a specifier that climbs out of the TestSet directory (the exact k7/k11/k13 shape) is reported as escaping', () => {
  const escapingImports = loadEscapingImports()
  const result = escapingImports({
    tests_ref: '.artifacts/tests/t1',
    imports: [{ file: '.artifacts/tests/t1/x.test.js', specifier: '../../../substrate/test/helpers.js' }],
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].file, '.artifacts/tests/t1/x.test.js')
  assert.equal(result[0].specifier, '../../../substrate/test/helpers.js')
})
