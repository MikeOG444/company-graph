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

  // Purity: no runtime handle anywhere in the block (shared with testValidity's own purity check).
  for (const token of ['agent(', 'parallel(', 'pipeline(', 'phase(', 'log(', 'budget.', 'ctx.']) {
    assert.ok(!block.includes(token), `the sentinel block must not reference "${token}"`)
  }
})

test('AC-13: a fix with behaviour_changed:false, for a finding that cites a test failure, is refused; true or absent is accepted; a finding that cites no test failure is never refused for that reason alone', () => {
  const { block } = extractBlock(readWorkflowText())
  const { hits } = findRefusalFn(block)
  assert.equal(hits.length, 1, 'expected to find exactly one behaviour_changed-driven decision function')
  const fnName = hits[0].name
  // eslint-disable-next-line no-new-func
  const fn = new Function(block + `\nreturn { ${fnName} }`)()[fnName]

  // A finding that cites a test failure (the shape the code fixer receives when routed from a failing test).
  const citesTestFailure = { id: 'f1', lens: 'correctness', evidence: 'test "AC-2 ..." failed: expected true, got false', location: 'app.js:10' }
  const noTestCitation = { id: 'f2', lens: 'security', evidence: 'secret logged in plaintext', location: 'app.js:20' }

  // Two ways this decision could plausibly be shaped: fn(changeSet, finding) or fn({ changeSet, finding }).
  // Try both call shapes so the test drives the decision by its PLAIN-OBJECT inputs (per AC-13's own wording)
  // without presuming an arity the spec never fixes.
  const call = (behaviour_changed, finding) => {
    const changeSet = behaviour_changed === undefined ? { notes: 'plain fix' } : { behaviour_changed, notes: 'plain fix' }
    let result
    try { result = fn(changeSet, finding) } catch { result = fn({ changeSet, finding }) }
    return result
  }

  const refusedFalse = call(false, citesTestFailure)
  const acceptedTrue = call(true, citesTestFailure)
  const acceptedAbsent = call(undefined, citesTestFailure)
  const notCitingTest = call(false, noTestCitation)

  // The exact return shape (boolean vs enum) is not fixed by the spec, so this checks the OBSERVABLE
  // distinction the spec asks for: behaviour_changed:false + a test-citing finding must be treated
  // differently (refused) from every other combination tried.
  assert.notDeepEqual(refusedFalse, acceptedTrue,
    'behaviour_changed:false must be decided differently from behaviour_changed:true for the same test-citing finding')
  assert.notDeepEqual(refusedFalse, acceptedAbsent,
    'behaviour_changed:false must be decided differently from behaviour_changed absent for the same test-citing finding')
  assert.notDeepEqual(refusedFalse, notCitingTest,
    'behaviour_changed:false must be decided differently when the finding does not cite a test failure at all')
})
