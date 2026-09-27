// spec-wi-b1-b2-memory-to-build AC-9. Written from the Spec only.
//
// "a memory roll with at least one valid pattern" / "build-spec builds the Decomposer prompt" / "the
// prompt includes the formatPatterns(selectPatterns(patterns)) text under a heading stating these are
// prior observations from past runs to avoid, not rules. The text comes from structured items selected in
// script code, never a raw JSON blob of the roll. The Spec Writer and Risk Router prompts are unchanged."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, loadPatternFunctions } from './k19-patterns-extract-helpers.js'
import { agentCallsByLabelRegex } from './k19-agent-call-helpers.js'

test('AC-9: selectPatterns(patterns) then formatPatterns(...) renders the exact text injected under the heading', () => {
  const { selectPatterns, formatPatterns } = loadPatternFunctions()
  const patterns = [{ id: 'p1', sample_size: 4, claim: 'X', kind: 'pattern' }]
  const expected = formatPatterns(selectPatterns(patterns))
  assert.equal(expected, 'p1 (n=4): X')
})

test('AC-9: the heading text frames the injected patterns as prior observations from past runs to avoid, not rules', () => {
  const text = readWorkflowText()
  const headingIdx = text.indexOf('Prior observations from past runs')
  assert.ok(headingIdx >= 0, 'expected a prior-observations heading literal')
  const headingWindow = text.slice(headingIdx, headingIdx + 300)
  assert.match(headingWindow, /AVOID/i, 'the heading must frame the patterns as things to avoid')
  assert.match(headingWindow, /not rules/i, 'the heading must explicitly say these are not rules')
  assert.match(headingWindow, /past runs/i, 'the heading must attribute the patterns to past runs')
  // The heading interpolates `formatted` (selectPatterns/formatPatterns output), never the raw mem/roll object.
  assert.match(headingWindow, /\$\{formatted\}/, 'expected the heading text to interpolate the structured `formatted` string')
  assert.doesNotMatch(headingWindow, /\$\{JSON\.stringify\(mem\)\}|\$\{mem\}/,
    'the heading must never interpolate a raw JSON blob of the memory-read result')
})

test('AC-9: the Spec Writer (spec:*) and Risk Router (route:*) prompts never reference priorObservationsText, mem, or the memory roll', () => {
  const text = readWorkflowText()
  const specCalls = agentCallsByLabelRegex(text, /^`spec:/)
  const routeCalls = agentCallsByLabelRegex(text, /^`route:/)
  assert.equal(specCalls.length, 1, 'expected exactly one spec:* agent() call')
  assert.equal(routeCalls.length, 1, 'expected exactly one route:* agent() call')
  for (const call of [...specCalls, ...routeCalls]) {
    assert.doesNotMatch(call.prompt, /priorObservationsText/, 'Spec Writer/Risk Router prompts must not reference priorObservationsText')
    assert.doesNotMatch(call.prompt, /\bmem\b/, 'Spec Writer/Risk Router prompts must not reference the memory-read result')
    assert.doesNotMatch(call.prompt, /Prior observations/i, 'Spec Writer/Risk Router prompts must carry no prior-observations heading')
  }
})
