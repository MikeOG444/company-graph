// Tests for spec-wi-b6-test-validity-before-blame's PURE `testValidity(facts)` function
// (AC-1 through AC-5). Written from the spec (ledger/runs/k10/spec-wi-b6-test-validity-before-blame.json)
// ONLY — every scenario below is transcribed from the acceptance criteria's own given/when/then, not
// from reading the implementation.
//
// testValidity is declared inside the fix-loop decisions sentinel block (the same block the existing
// seventeen decision functions live in), so it is extracted the same way AC-1 describes: cut the block
// with extractBlock and evaluate it with `new Function`, exactly as substrate/test/extract-fixloop.js's
// loadFixLoopDecisions already does for the seventeen. This file does its OWN `new Function` call (rather
// than editing extract-fixloop.js, which AC-17 says must keep returning its seventeen unchanged) so it
// asks for testValidity by name without assuming anything about the other functions' shape.
//
// Lands in substrate/test/ and runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
// Repository paths are resolved only through the existing extract-fixloop.js sentinel extractor, never by
// counting ".." from this file's own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'

function loadTestValidity() {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block, 'fix-loop decisions block must be extractable between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + '\nreturn { testValidity }')
  const { testValidity } = factory()
  assert.equal(typeof testValidity, 'function', 'testValidity must be declared inside the sentinel block')
  return testValidity
}

test('AC-1: testValidity is a pure function declared in the sentinel block, taking one facts object and returning only test_defect/code_defect/unclear', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1, 'BEGIN sentinel line must appear exactly once')
  assert.equal(endCount, 1, 'END sentinel line must appear exactly once')
  assert.ok(block && block.includes('testValidity'), 'testValidity must be declared between the sentinel lines')

  // Purity: no runtime handle crosses in. The whole block (not just testValidity's own body) must stay free
  // of these tokens, exactly as AC-1 in the pre-existing fix-loop-decisions.test.js already requires for the
  // seventeen decisions this function joins. Note: 'ctx.' is NOT one of these tokens — several of the
  // pre-existing seventeen decisions (e.g. shouldEscalate) take a `ctx` parameter and reference it, and that
  // is a plain function parameter, not a runtime handle crossing in from the workflow's closure; banning it
  // would fail against the correct, unmodified pre-existing decisions this block already contains.
  for (const token of ['args', 'agent(', 'parallel(', 'pipeline(', 'phase(', 'log(', 'budget.']) {
    assert.ok(!block.includes(token), `the extractable block (including testValidity) must not reference "${token}"`)
  }
  assert.ok(!/\bawait\b/.test(block), 'the extractable block must not contain await')

  const testValidity = loadTestValidity()
  const VALID = new Set(['test_defect', 'code_defect', 'unclear'])
  const samples = [
    { locates_by_first_occurrence: true, requires_unquoted_literal: false, fails_on_base_same_reason: false, names_criterion_behaviour: true },
    { locates_by_first_occurrence: false, requires_unquoted_literal: false, fails_on_base_same_reason: false, names_criterion_behaviour: true },
    {},
  ]
  for (const facts of samples) {
    const result = testValidity(facts)
    assert.ok(VALID.has(result), `testValidity(${JSON.stringify(facts)}) returned "${result}", not one of test_defect/code_defect/unclear`)
  }
})

test('AC-2: a test that locates by first textual occurrence, or requires an unquoted literal, is a test_defect even when it names the criterion behaviour', () => {
  const testValidity = loadTestValidity()
  assert.equal(
    testValidity({ locates_by_first_occurrence: true, requires_unquoted_literal: false, fails_on_base_same_reason: false, names_criterion_behaviour: true }),
    'test_defect',
  )
  assert.equal(
    testValidity({ locates_by_first_occurrence: false, requires_unquoted_literal: true, fails_on_base_same_reason: false, names_criterion_behaviour: true }),
    'test_defect',
  )
})

test('AC-3: a test that fails on the task\'s base commit for the same reason, and does not describe the cited criterion\'s behaviour, is a test_defect', () => {
  const testValidity = loadTestValidity()
  assert.equal(
    testValidity({ locates_by_first_occurrence: false, requires_unquoted_literal: false, fails_on_base_same_reason: true, names_criterion_behaviour: false }),
    'test_defect',
  )
})

test('AC-4: a test with none of the defect facts but that does name the criterion\'s behaviour is a code_defect', () => {
  const testValidity = loadTestValidity()
  assert.equal(
    testValidity({ locates_by_first_occurrence: false, requires_unquoted_literal: false, fails_on_base_same_reason: false, names_criterion_behaviour: true }),
    'code_defect',
  )
})

test('AC-5: with no established facts, testValidity never throws and never returns test_defect or code_defect — a missing or non-boolean fact never counts as true', () => {
  const testValidity = loadTestValidity()
  const scenarios = [
    { locates_by_first_occurrence: false, requires_unquoted_literal: false, fails_on_base_same_reason: false, names_criterion_behaviour: false },
    { fails_on_base_same_reason: true, names_criterion_behaviour: true, locates_by_first_occurrence: false, requires_unquoted_literal: false },
    {},
    null,
    undefined,
    { locates_by_first_occurrence: 'yes', requires_unquoted_literal: 1, fails_on_base_same_reason: 'yes', names_criterion_behaviour: 1 },
  ]
  for (const facts of scenarios) {
    let result
    assert.doesNotThrow(() => { result = testValidity(facts) }, `testValidity(${JSON.stringify(facts)}) must not throw`)
    assert.equal(result, 'unclear', `testValidity(${JSON.stringify(facts)}) must be 'unclear', got "${result}"`)
  }
})
