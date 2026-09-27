// spec-wi-c15-c12-c14-line-guards AC-1. Written from the Spec only.
//
// "The fix-loop decisions block ... extended with outputCeiling, verifyGate, newStrays and any ratio or
// budget-state helper the implementation adds, and it is evaluated. Every named function is defined and
// callable with no reference to args, budget, agent or any identifier outside the block. The block contains
// a named constant equal to 4 used as the default billed/output ratio, with a comment that cites the ledger
// measurement."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopFunctions } from './k21-fixloop-all.js'

test('AC-1: the sentinel block defines outputCeiling, verifyGate and newStrays, and each is callable', () => {
  const { fns, names } = loadAllFixLoopFunctions()
  for (const required of ['outputCeiling', 'verifyGate', 'newStrays']) {
    assert.ok(names.includes(required), `expected ${required} to be declared inside the fix-loop decisions block`)
    assert.equal(typeof fns[required], 'function', `expected ${required} to be a callable function`)
  }
})

test('AC-1: the block evaluates standalone via new Function with no reference to args, budget or agent', () => {
  // loadAllFixLoopFunctions already runs `new Function(block)` — if the block referenced any identifier
  // outside itself (args, budget, agent, ctx, ...) that isn't a global, evaluating it standalone would throw
  // a ReferenceError at call time for at least one of the new functions, since none of those names are
  // declared inside the block itself.
  const { fns } = loadAllFixLoopFunctions()
  assert.doesNotThrow(() => fns.outputCeiling(1000000, 4), 'outputCeiling must not reference anything outside the block')
  assert.doesNotThrow(() => fns.newStrays({ reported: [], baseline: [], artifact_dir: '.artifacts' }),
    'newStrays must not reference anything outside the block')
  assert.doesNotThrow(
    () => fns.verifyGate({ read: { found: true, status: 'decided', gate: 'spec_gate', option: 'approve', id: 'x' }, gate_id: 'x' }),
    'verifyGate must not reference anything outside the block',
  )
})

test('AC-1: the block declares a named constant equal to 4, used as the default billed/output ratio, with a comment citing the ledger measurement', () => {
  const { block } = loadAllFixLoopFunctions()
  const constMatch = block.match(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*4\b/)
  assert.ok(constMatch, `expected a named ALL_CAPS constant equal to 4 in the fix-loop decisions block, block was:\n${block.slice(0, 2000)}`)
  // The Spec's goal text itself names this constant DEFAULT_BILLED_PER_OUTPUT, so that exact identifier is
  // required (an exact literal the Spec quotes), not merely "some constant named 4".
  assert.equal(constMatch[1], 'DEFAULT_BILLED_PER_OUTPUT',
    `expected the constant to be named DEFAULT_BILLED_PER_OUTPUT as the Spec names it, found ${constMatch[1]}`)
  const idx = constMatch.index
  const surrounding = block.slice(Math.max(0, idx - 500), idx + 50)
  assert.match(surrounding, /ledger/i, 'expected a nearby comment citing the ledger measurement')
  assert.match(surrounding, /\d/, 'expected the nearby comment to cite actual measured figures, not just the word "ledger"')
})
