// AC-6: the fix-loop decisions block of .claude/workflows/build-implement.js, extracted with
// extract-fixloop.js's readWorkflowText()/extractBlock() and evaluated with `new Function`, evaluates
// without throwing, the BEGIN and END sentinels each appear exactly once, changeScopedCriteria and
// testFileBasename are functions, and every decision function the existing loaders expose (including
// unaccountedTestFiles, unlandedRepairs, boundaryRepair, escapingImports) is still a function.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock, loadAllFixLoopDecisions, ALL_DECISION_NAMES } from './k17-helpers.js'

test('AC-6: sentinels appear exactly once, and every decision function (old and new) evaluates as a function', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1, 'BEGIN sentinel must appear exactly once')
  assert.equal(endCount, 1, 'END sentinel must appear exactly once')
  assert.ok(block, 'expected a non-null block between the sentinels')

  const decisions = loadAllFixLoopDecisions()
  assert.equal(typeof decisions.changeScopedCriteria, 'function')
  assert.equal(typeof decisions.testFileBasename, 'function')
  for (const name of ['unaccountedTestFiles', 'unlandedRepairs', 'boundaryRepair', 'escapingImports']) {
    assert.equal(typeof decisions[name], 'function', `expected ${name} to still be a function`)
  }
  for (const name of ALL_DECISION_NAMES) {
    assert.equal(typeof decisions[name], 'function', `expected ${name} to be a function`)
  }
})
