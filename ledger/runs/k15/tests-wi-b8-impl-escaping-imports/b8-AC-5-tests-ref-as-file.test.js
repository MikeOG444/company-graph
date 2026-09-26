// spec-wi-b8-tests-run-the-task-code AC-5. Written from the Spec only.
//
// "escapingImports loaded from the sentinel block. tests_ref is a file, e.g. '.artifacts/tests/t1/x.test.js',
// and imports are [{ file: '.artifacts/tests/t1/x.test.js', specifier: './helpers.js' },
// { file: '.artifacts/tests/t1/x.test.js', specifier: '../t2/z.js' }]. The TestSet directory is taken to be
// '.artifacts/tests/t1'. Only the '../t2/z.js' entry is returned."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEscapingImports } from './b8-escaping-imports-helpers.js'

test('AC-5: when tests_ref names a file, the TestSet directory is taken to be its containing directory', () => {
  const escapingImports = loadEscapingImports()
  const result = escapingImports({
    tests_ref: '.artifacts/tests/t1/x.test.js',
    imports: [
      { file: '.artifacts/tests/t1/x.test.js', specifier: './helpers.js' },
      { file: '.artifacts/tests/t1/x.test.js', specifier: '../t2/z.js' },
    ],
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].specifier, '../t2/z.js')
})
