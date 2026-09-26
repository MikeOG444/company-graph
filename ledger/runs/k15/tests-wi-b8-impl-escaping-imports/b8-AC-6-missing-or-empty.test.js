// spec-wi-b8-tests-run-the-task-code AC-6. Written from the Spec only.
//
// "escapingImports loaded from the sentinel block. It is called with imports missing or empty, or with
// entries that have no specifier. It returns [] and does not throw."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEscapingImports } from './b8-escaping-imports-helpers.js'

test('AC-6: a missing imports property returns [] without throwing', () => {
  const escapingImports = loadEscapingImports()
  assert.doesNotThrow(() => {
    const result = escapingImports({ tests_ref: '.artifacts/tests/t1' })
    assert.deepEqual(result, [])
  })
})

test('AC-6: an empty imports array returns []', () => {
  const escapingImports = loadEscapingImports()
  const result = escapingImports({ tests_ref: '.artifacts/tests/t1', imports: [] })
  assert.deepEqual(result, [])
})

test('AC-6: entries with no specifier are ignored, not thrown on', () => {
  const escapingImports = loadEscapingImports()
  assert.doesNotThrow(() => {
    const result = escapingImports({
      tests_ref: '.artifacts/tests/t1',
      imports: [{ file: '.artifacts/tests/t1/x.test.js' }, { file: '.artifacts/tests/t1/x.test.js', specifier: '' }],
    })
    assert.deepEqual(result, [])
  })
})
