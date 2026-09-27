// spec-wi-b1-b2-memory-to-build AC-17. Written from the Spec only.
//
// "build-implement invoked with args.memory_ref whose read returns null, throws, or yields an empty,
// missing or malformed canaries list" / "the workflow runs" / "the run does not fail, no library canary
// is injected, tasks record canary_source 'none' (or 'args' where args.canary matched), and every other
// output field is unchanged"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'

// loadFixLoopDecisions() (extract-fixloop.js) exposes a fixed, exactly-asserted-elsewhere set of names that
// predates selectCanary (see boundary-decision-functions.test.js's exact name-list check) — so selectCanary is
// pulled out here the same way (the sentinel-extraction idiom AC-10 itself describes: evaluate the extracted
// block standalone), without editing that shared helper's asserted-exact export list.
function loadSelectCanary() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + '\n    return { selectCanary }')
  return factory()
}

test('AC-17: selectCanary returns null without throwing for an empty, missing or malformed canaries list', () => {
  const { selectCanary } = loadSelectCanary()
  const task = { id: 't1', owned_surfaces: [{ ref: '.claude/workflows/build-implement.js' }] }
  for (const badCanaries of [[], undefined, null, [{}], [{ id: 'c1' }], [{ id: 'c1', mutation: 42 }], 'garbage']) {
    assert.equal(selectCanary({ canaries: badCanaries, task, run_id: 'r1' }), null,
      `expected selectCanary to return null (never throw) for canaries=${JSON.stringify(badCanaries)}`)
  }
})

test('AC-17: libraryCanaries falls back to [] whenever the memory-read result is null or its canaries field is missing/non-array', () => {
  const text = readWorkflowText()
  assert.match(text, /libraryCanaries\s*=\s*Array\.isArray\(\s*mem\?\.\s*canaries\s*\)\s*\?\s*mem\.canaries\s*:\s*\[\]/,
    'expected libraryCanaries to be derived from Array.isArray(mem?.canaries) ? mem.canaries : [], ' +
    'so a null mem (or a mem with a missing/malformed canaries field) safely yields []')
})

test('AC-17: when no library canary is picked, canary_source is set to \'none\' unless an explicit args.canary already matched (\'args\')', () => {
  const text = readWorkflowText()
  const pickedIdx = text.indexOf('const picked = libraryCanaries.length ? selectCanary(')
  assert.ok(pickedIdx >= 0, 'expected the canary-selection call site keyed off libraryCanaries.length')
  const window = text.slice(pickedIdx, pickedIdx + 400)
  assert.match(window, /if\s*\(picked\)\s*\{[\s\S]*?ctx\.canary_source\s*=\s*'library'/,
    'expected a truthy-picked branch that records canary_source \'library\'')
  assert.match(window, /else\s*\{[\s\S]*?ctx\.canary_source\s*=\s*'none'/,
    'expected the falsy-picked (no eligible library canary, e.g. from an empty/malformed canaries list) branch to record canary_source \'none\'')
  // And the args.canary branch (taken first, before the library branch is ever reached) records 'args'.
  const argsIdx = text.indexOf('if (A.canary &&')
  assert.ok(argsIdx >= 0, 'expected an args.canary branch guarding canary_source assignment')
  const argsWindow = text.slice(argsIdx, argsIdx + 200)
  assert.match(argsWindow, /ctx\.canary_source\s*=\s*'args'/, "expected the args.canary branch to record canary_source 'args'")
  assert.ok(argsIdx < pickedIdx, 'the args.canary check must be reached (and can short-circuit the library path) before the library-canary selection')
})

test('AC-17: no canary mutation is injected when neither args.canary nor a library canary applies', () => {
  const { selectCanary } = loadSelectCanary()
  const task = { id: 't1', owned_surfaces: [{ ref: '.claude/workflows/build-implement.js' }] }
  const picked = selectCanary({ canaries: [], task, run_id: 'r1' })
  assert.equal(picked, null)
  // canaryMutation is only ever set from args.canary.mutation or picked.mutation (see the canary-source wiring
  // above); with args.canary absent and picked === null, canaryMutation stays null and no injection agent() runs.
  const text = readWorkflowText()
  assert.match(text, /let canaryMutation = null/, 'expected canaryMutation to default to null')
  assert.match(text, /if\s*\(canaryMutation\)\s*\{/, 'expected the canary-mutation injection to be guarded by a truthy canaryMutation check')
})
