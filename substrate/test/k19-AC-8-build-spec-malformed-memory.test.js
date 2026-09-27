// spec-wi-b1-b2-memory-to-build AC-8. Written from the Spec only.
//
// "the memory-read agent returns null or throws, or returns an object with empty, missing or malformed
// patterns" / "build-spec continues" / "the run does not fail. selectPatterns yields []. The Decomposer
// prompt is identical to the no-memory_ref prompt, with no empty heading. The spec/graph/lint output
// shape is unchanged."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, loadPatternFunctions } from './k19-patterns-extract-helpers.js'
import { ifBlocksMatching } from './k19-agent-call-helpers.js'

test('AC-8: selectPatterns yields [] for a null, missing, empty or malformed patterns value (mirrors an agent() result of null or a malformed object)', () => {
  const { selectPatterns } = loadPatternFunctions()
  assert.deepEqual(selectPatterns(undefined), [], 'a null/undefined mem.patterns (from a null mem or a missing field) must yield []')
  assert.deepEqual(selectPatterns(null), [], 'a null patterns value must yield []')
  assert.deepEqual(selectPatterns([]), [], 'an empty patterns array must yield []')
  assert.deepEqual(selectPatterns([{}, { id: 1, claim: 2 }, null, 'nope']), [],
    'a patterns array of only malformed entries must yield []')
  assert.deepEqual(selectPatterns('not-an-array'), [], 'a non-array patterns value must yield [], never throw')
})

test('AC-8: chosenPatterns is computed from mem?.patterns (optional chaining), so the workflow does not fail when the memory-read agent returns null', () => {
  const text = readWorkflowText()
  assert.match(text, /selectPatterns\(\s*mem\?\.\s*patterns\s*\)/,
    'expected chosenPatterns to be derived from selectPatterns(mem?.patterns), which stays safe (undefined -> []) when mem is null')
})

test('AC-8: an empty/malformed result (formatted === \'\') leaves the Decomposer prompt heading-free, exactly like the no-memory_ref case', () => {
  const { selectPatterns, formatPatterns } = loadPatternFunctions()
  // Reproduce the exact composition the workflow performs: selectPatterns(mem?.patterns) then formatPatterns(...).
  for (const badPatterns of [undefined, null, [], [{}], 'garbage']) {
    const formatted = formatPatterns(selectPatterns(badPatterns))
    assert.equal(formatted, '', `expected formatPatterns(selectPatterns(...)) to be '' for malformed patterns input ${JSON.stringify(badPatterns)}`)
  }
  // And the workflow only ever sets priorObservationsText inside `if (formatted)`, so formatted === '' leaves
  // priorObservationsText at its initial '' — the same value used when args.memory_ref is absent entirely.
  const formattedBlocks = ifBlocksMatching(readWorkflowText(), /^\s*formatted\s*$/)
  assert.ok(formattedBlocks.length > 0, 'expected an `if (formatted)` guard around the heading assignment')
})
