// AC-11: testFileBasename, called with 'x.js (already exists)', 'dir/x.js', 'x.js',
// 'substrate/test/x.js (skipped: exists)' and '  x.js  ', returns 'x.js' for every input.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

test('AC-11: testFileBasename strips trailing parentheticals and directories to a bare basename', () => {
  const { testFileBasename } = loadAllFixLoopDecisions()
  const inputs = [
    'x.js (already exists)',
    'dir/x.js',
    'x.js',
    'substrate/test/x.js (skipped: exists)',
    '  x.js  ',
  ]
  for (const input of inputs) {
    assert.equal(testFileBasename(input), 'x.js', `expected testFileBasename(${JSON.stringify(input)}) === 'x.js'`)
  }
})
