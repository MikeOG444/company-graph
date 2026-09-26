// Tests for spec-wi-b6-test-validity-before-blame AC-13's fix-refusal decision: "the decision whether a
// fix is refused is a pure function inside the sentinel block, and a test drives it with plain objects for
// behaviour_changed false / true / absent and for a finding that does / does not cite a test failure."
//
// The spec does not name this function (unlike testValidity, which AC-1 names explicitly), so this file
// locates it structurally rather than guessing a name: it is the one function declared inside the fix-loop
// decisions sentinel block whose body reads `behaviour_changed`. Written from the spec ONLY — the
// discovery method itself only inspects DECLARATION SHAPE (which functions exist and what identifiers
// their bodies reference), never behaviour read from an implementation.
//
// Lands in substrate/test/ and runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
// Repository paths are resolved only through the existing extract-fixloop.js sentinel extractor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'
import { functionDecls } from './b5-wiring-helpers.js'

function findRefusalFn(block) {
  const decls = functionDecls(block)
  const hits = decls.filter(d => block.slice(d.bodyStart, d.bodyEnd).includes('behaviour_changed'))
  return { decls, hits }
}

test('AC-13: exactly one pure decision function inside the sentinel block reads behaviour_changed, and it is callable with plain objects', () => {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block, 'fix-loop decisions block must be extractable')
  const { hits } = findRefusalFn(block)
  assert.equal(hits.length, 1,
    `expected exactly one function in the sentinel block deciding on behaviour_changed, found ${hits.length} (${hits.map(h => h.name).join(',')})`)

  const fnName = hits[0].name
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `\nreturn { ${fnName} }`)
  const fn = factory()[fnName]
  assert.equal(typeof fn, 'function')

  // Purity of THIS function's own body. k11's version banned 'ctx.' across the whole block, which the
  // pre-existing decisions legitimately use as a parameter name, and a fixer renamed them to satisfy it (k11d).
  const body = block.slice(hits[0].bodyStart, hits[0].bodyEnd)
  for (const token of ['agent(', 'parallel(', 'pipeline(', 'phase(', 'log(', 'budget.', 'ctx.', 'args', 'A.']) {
    assert.ok(!body.includes(token), `${fnName} must not reference "${token}"`)
  }
})

test('AC-13: a fix with behaviour_changed:false, for a finding that cites a test failure, is refused; true or absent is accepted; a finding that cites no test failure is never refused for that reason alone', () => {
  // Rewritten at k11d. k11's version guessed the call shape (changeSet, finding); the function takes the two
  // facts the spec names — behaviour_changed and whether the finding cites a failing test — and citation is
  // decided separately by citesFailingTest over this round's failing test names.
  const { block } = extractBlock(readWorkflowText())
  const { hits } = findRefusalFn(block)
  const fnName = hits[0].name
  // eslint-disable-next-line no-new-func
  const { [fnName]: refused, citesFailingTest } = new Function(block + `\nreturn { ${fnName}, citesFailingTest }`)()
  assert.equal(typeof citesFailingTest, 'function', 'citation of a failing test is decided by a pure function in the block')

  const failing = ['AC-2 returns the value']
  const citing = { id: 'f1', lens: 'correctness', claim: 'AC-2 returns the value failed', evidence: 'test "AC-2 returns the value" failed: expected true, got false', location: 'app.js:10' }
  const notCiting = { id: 'f2', lens: 'security', claim: 'secret logged', evidence: 'secret logged in plaintext', location: 'app.js:20' }
  assert.equal(citesFailingTest(citing, failing), true)
  assert.equal(citesFailingTest(notCiting, failing), false)
  assert.equal(citesFailingTest(citing, []), false, 'no failing tests this round means nothing can be cited')

  const decide = (behaviour_changed, finding) => refused({ behaviour_changed, cites_test_failure: citesFailingTest(finding, failing) })
  assert.equal(decide(false, citing), true, 'behaviour_changed:false for a test-citing finding is refused')
  assert.equal(decide(true, citing), false, 'behaviour_changed:true is accepted')
  assert.equal(decide(undefined, citing), false, 'behaviour_changed absent (an older fixer) is accepted')
  assert.equal(decide(false, notCiting), false, 'a finding citing no failing test is never refused for this reason')
  assert.equal(decide('false', citing), false, 'only the boolean false refuses, never a string')
})
