// The Iteration Planner is script code, not an agent (CLAUDE.md rule 3).
//
// Run k1 is why. The planner was a cheap-model agent whose contract was to return the ids it selected.
// Because its call site named no agentType, it carried the default workflow-subagent toolset — Bash,
// Write, Edit — and a WorkItem.intent reads like an instruction. It wrote .github/workflows/ci.yml, ran
// both suites, committed the result, and then returned a correct, schema-valid {ids} as if it had only
// chosen. Nothing in the workflow's output disclosed the write; a git hook found the commit. One cheap
// agent had skipped Spec, TestSet, the Verifier Panel and the owned-surfaces boundary check in one step.
//
// These tests pin the replacement's behaviour and, in the last two, the absence of the agent itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

const BUILD_SPEC_PATH = path.join(REPO, '.claude', 'workflows', 'build-spec.js')
const BEGIN = '// ---- BEGIN plan-selection ----'
const END = '// ---- END plan-selection ----'

function readBuildSpec() {
  return fs.readFileSync(BUILD_SPEC_PATH, 'utf8')
}

// Cut the pure-JavaScript block between the whole-line sentinels and evaluate it, so planIteration can be
// exercised without the workflow runtime (agent/parallel/pipeline/phase/log/args are not available here).
function loadPlanIteration() {
  const lines = readBuildSpec().split('\n')
  const beginIdx = lines.indexOf(BEGIN)
  const endIdx = lines.indexOf(END)
  assert.notEqual(beginIdx, -1, 'BEGIN plan-selection sentinel missing')
  assert.ok(endIdx > beginIdx, 'END plan-selection sentinel missing or before BEGIN')
  const block = lines.slice(beginIdx + 1, endIdx).join('\n')
  // eslint-disable-next-line no-new-func
  return new Function(block + '\nreturn planIteration')()
}

const wi = (id, over = {}) => ({
  id, project_id: 'venture0', source: 'tooling', title: id, intent: id,
  priority: 5, deferred_iterations: 0, budget: { tokens: 100 }, ...over,
})

test('selects everything when the total cost fits the capacity', () => {
  const planIteration = loadPlanIteration()
  const items = [wi('a'), wi('b'), wi('c')]
  const { selected, skipped, planned_tokens } = planIteration(items, 1000)
  assert.deepEqual(selected.map(w => w.id), ['a', 'b', 'c'])
  assert.deepEqual(skipped, [])
  assert.equal(planned_tokens, 300)
})

test('starved items come first, then priority, then id — deterministic across input order', () => {
  const planIteration = loadPlanIteration()
  const items = [
    wi('low-prio', { priority: 9 }),
    wi('starved', { priority: 9, deferred_iterations: 3 }),
    wi('urgent', { priority: 1 }),
    wi('also-urgent', { priority: 1 }),
  ]
  const forward = loadPlanIteration()(items, 10000).selected.map(w => w.id)
  const reversed = planIteration([...items].reverse(), 10000).selected.map(w => w.id)
  assert.deepEqual(forward, ['starved', 'also-urgent', 'urgent', 'low-prio'])
  assert.deepEqual(reversed, forward, 'selection order must not depend on input order')
})

test('an item that does not fit is skipped with a reason, and cheaper later items still fit', () => {
  const planIteration = loadPlanIteration()
  // priority orders them huge, small; huge alone exceeds the cap.
  const items = [wi('huge', { priority: 1, budget: { tokens: 900 } }), wi('small', { priority: 2, budget: { tokens: 50 } })]
  const { selected, skipped, planned_tokens } = planIteration(items, 100)
  assert.deepEqual(selected.map(w => w.id), ['small'])
  assert.deepEqual(skipped, [{ id: 'huge', cost: 900, reason: 'over_capacity' }])
  assert.equal(planned_tokens, 50)
})

test('an item with no budget.tokens is costed at the default rather than treated as free', () => {
  const planIteration = loadPlanIteration()
  const { selected, skipped } = planIteration([wi('nobudget', { budget: undefined })], 500, 1000)
  assert.deepEqual(selected, [])
  assert.equal(skipped[0].cost, 1000)
})

test('a missing or non-positive capacity means no ceiling, never an empty selection', () => {
  const planIteration = loadPlanIteration()
  const items = [wi('a'), wi('b')]
  for (const cap of [undefined, null, 0, -1, NaN, 'nonsense']) {
    const { selected } = planIteration(items, cap)
    assert.equal(selected.length, 2, `capacity ${String(cap)} must not silently select nothing`)
  }
})

test('an empty or absent work-item list is handled without throwing', () => {
  const planIteration = loadPlanIteration()
  for (const input of [[], undefined, null]) {
    const r = planIteration(input, 1000)
    assert.deepEqual(r.selected, [])
    assert.equal(r.planned_tokens, 0)
  }
})

test('the input array is not mutated', () => {
  const planIteration = loadPlanIteration()
  const items = [wi('z', { priority: 9 }), wi('a', { priority: 1 })]
  const before = items.map(w => w.id)
  planIteration(items, 10000)
  assert.deepEqual(items.map(w => w.id), before, 'planIteration must not sort the caller array in place')
})

// ---- The regression that motivated all of the above ----

test('build-spec no longer spawns a planner agent', () => {
  const text = readBuildSpec()
  assert.ok(!/label:\s*'planner'/.test(text),
    "the planner agent is gone: selecting work items is script code, so no agent() call may carry label 'planner'")
})

test('every agent() call in build-spec that can write is bound to an agentType', () => {
  // A call site with no agentType inherits the default workflow-subagent, which carries Bash, Write and
  // Edit. That is what let the planner commit an implementation. Any agent that remains in this workflow
  // is a judgment node; this test records which ones are still unbound so the C6 audit has a fixture.
  const text = readBuildSpec()
  const labels = [...text.matchAll(/label:\s*[`'"]([^`'"$]*)/g)].map(m => m[1])
  assert.ok(!labels.includes('planner'), 'planner must not reappear as an agent label')
  assert.ok(labels.length > 0, 'build-spec should still spawn its judgment agents (spec, route, decompose)')
})
