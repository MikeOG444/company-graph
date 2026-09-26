// AC-15: the bodies of unaccountedTestFiles and unlandedRepairs both call testFileBasename (a single
// shared normaliser), and the fix-loop decisions block (including changeScopedCriteria and
// testFileBasename) uses no import, require, fs, path module, Date.now or Math.random.
//
// Call sites located via b5-wiring-helpers (functionNamed/callSites), never by first textual occurrence.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './k17-helpers.js'
import { functionNamed, callSites } from './b5-wiring-helpers.js'

test('AC-15: unaccountedTestFiles and unlandedRepairs both call testFileBasename', () => {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block, 'expected the fix-loop decisions block to be extractable')

  const unaccounted = functionNamed(block, 'unaccountedTestFiles')
  const unaccountedBody = block.slice(unaccounted.bodyStart, unaccounted.bodyEnd)
  assert.ok(callSites(unaccountedBody, 'testFileBasename').length >= 1,
    'expected unaccountedTestFiles to call testFileBasename')

  const unlanded = functionNamed(block, 'unlandedRepairs')
  const unlandedBody = block.slice(unlanded.bodyStart, unlanded.bodyEnd)
  assert.ok(callSites(unlandedBody, 'testFileBasename').length >= 1,
    'expected unlandedRepairs to call testFileBasename')
})

test('AC-15: the fix-loop block uses no import, require, fs, path module, Date.now or Math.random', () => {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block, 'expected the fix-loop decisions block to be extractable')
  assert.doesNotMatch(block, /\bimport\s*(?:\{|\*|[\w$]+\s*,?\s*(?:\{[^}]*\})?\s*from\b|\()/,
    'no import statement or dynamic import() allowed in the fix-loop block')
  assert.doesNotMatch(block, /\brequire\s*\(\s*['"]/, 'no require(...) call allowed in the fix-loop block')
  assert.doesNotMatch(block, /\bfs\.\w/, 'no fs module usage allowed in the fix-loop block')
  assert.doesNotMatch(block, /\bpath\.(join|resolve|dirname|basename|extname|sep)\b/,
    'no node:path module usage allowed in the fix-loop block')
  assert.doesNotMatch(block, /Date\.now\s*\(/, 'no Date.now() allowed in the fix-loop block')
  assert.doesNotMatch(block, /Math\.random\s*\(/, 'no Math.random() allowed in the fix-loop block')
})
