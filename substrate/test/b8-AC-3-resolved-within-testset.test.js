// spec-wi-b8-tests-run-the-task-code AC-3. Written from the Spec only.
//
// "escapingImports loaded from the sentinel block and tests_ref '.artifacts/tests/t1'. It is called with
// imports whose file is '.artifacts/tests/t1/x.test.js' and whose specifiers are './helpers.js' and
// './sub/y.js', plus a file '.artifacts/tests/t1/sub/y.js' importing '../helpers.js'. It returns []. A
// specifier resolved against the importing file's own directory that stays inside the TestSet directory
// never escapes."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEscapingImports } from './b8-escaping-imports-helpers.js'

test('AC-3: specifiers resolved against their own importing file that stay inside the TestSet directory never escape', () => {
  const escapingImports = loadEscapingImports()
  const result = escapingImports({
    tests_ref: '.artifacts/tests/t1',
    imports: [
      { file: '.artifacts/tests/t1/x.test.js', specifier: './helpers.js' },
      { file: '.artifacts/tests/t1/x.test.js', specifier: './sub/y.js' },
      { file: '.artifacts/tests/t1/sub/y.js', specifier: '../helpers.js' },
    ],
  })
  assert.deepEqual(result, [])
})
