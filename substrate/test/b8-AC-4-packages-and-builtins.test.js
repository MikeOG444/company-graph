// spec-wi-b8-tests-run-the-task-code AC-4. Written from the Spec only.
//
// "escapingImports loaded from the sentinel block and tests_ref '.artifacts/tests/t1'. It is called with
// imports from '.artifacts/tests/t1/x.test.js' whose specifiers are 'node:fs', 'assert' and a package name
// such as 'some-pkg/sub'. It returns []. Package names and node: builtins never escape."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEscapingImports } from './b8-escaping-imports-helpers.js'

test('AC-4: node: builtins and bare package specifiers never escape', () => {
  const escapingImports = loadEscapingImports()
  const result = escapingImports({
    tests_ref: '.artifacts/tests/t1',
    imports: [
      { file: '.artifacts/tests/t1/x.test.js', specifier: 'node:fs' },
      { file: '.artifacts/tests/t1/x.test.js', specifier: 'assert' },
      { file: '.artifacts/tests/t1/x.test.js', specifier: 'some-pkg/sub' },
    ],
  })
  assert.deepEqual(result, [])
})
