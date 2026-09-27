// spec-wi-b1-b2-memory-to-build AC-6. Written from the Spec only.
//
// "build-spec invoked without args.memory_ref" / "the workflow runs" / "no memory-reading agent call is
// made (source structure: the only memory-read agent call is guarded by args.memory_ref being truthy),
// and the Decomposer prompt contains no memory or prior-observation heading, so it is byte-identical to
// today's prompt text"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './k19-patterns-extract-helpers.js'
import { agentCalls, agentCallsByLabelRegex, isGuardedBy, ifBlocksMatching } from './k19-agent-call-helpers.js'

function memoryReadCalls(text) {
  return agentCalls(text).filter(c => /result\.roll/.test(c.prompt) || /memory_ref/.test(c.prompt))
}

test('AC-6: build-spec.js makes exactly one memory-read agent call, and it is guarded by args.memory_ref being truthy', () => {
  const text = readWorkflowText()
  const calls = memoryReadCalls(text)
  assert.equal(calls.length, 1, `expected exactly one memory-read agent() call, found ${calls.length}`)
  const [call] = calls
  assert.ok(isGuardedBy(text, call.nameStart, /A\.memory_ref/),
    'without args.memory_ref being truthy, source structure shows the memory-read agent() call cannot run at all')
})

test('AC-6: the prior-observations heading text only appears inside the args.memory_ref guard, never unconditionally', () => {
  const text = readWorkflowText()
  const headingIdx = text.indexOf('Prior observations from past runs')
  assert.ok(headingIdx >= 0, 'expected a prior-observations heading string literal somewhere in build-spec.js')
  assert.ok(isGuardedBy(text, headingIdx, /A\.memory_ref/),
    'the prior-observations heading text must sit inside the args.memory_ref guard, so it never renders when memory_ref is absent')
  // Also make sure it is nested one guard deeper, behind a non-empty `formatted` check — so even inside
  // an args.memory_ref guard, a falsy/empty result still yields no heading text.
  const formattedBlocks = ifBlocksMatching(text, /^\s*formatted\s*$/)
  assert.ok(formattedBlocks.length > 0, 'expected an `if (formatted)` guard around the heading assignment')
  const inFormattedBlock = formattedBlocks.some(b => headingIdx > b.ifBlock.start && headingIdx < b.ifBlock.end)
  assert.ok(inFormattedBlock, 'the heading text must sit inside the `if (formatted)` guard')
})

test('AC-6: the Decomposer prompt template appends priorObservationsText by interpolation only, right after the Spec JSON — so an empty value leaves the prompt text identical to a version with no memory support at all', () => {
  const text = readWorkflowText()
  const decomposeCalls = agentCallsByLabelRegex(text, /decompose/)
  assert.equal(decomposeCalls.length, 1, 'expected exactly one decompose:* agent() call')
  const [call] = decomposeCalls
  assert.match(call.prompt, /Spec: \$\{JSON\.stringify\(spec\)\}\$\{priorObservationsText\}/,
    'expected the decompose prompt to end its Spec text with a bare ${priorObservationsText} interpolation, ' +
    'so with priorObservationsText === \'\' the rendered prompt is byte-identical to a version without it')
  assert.doesNotMatch(call.prompt, /Prior observations/,
    'the decompose prompt template itself must not hardcode the heading text; it only ever arrives via the interpolated variable')
})

test('AC-6: priorObservationsText is declared \'\' outside (before) any memory_ref guard, so it is unconditionally empty when args.memory_ref is absent', () => {
  const text = readWorkflowText()
  const declIdx = text.indexOf("let priorObservationsText = ''")
  assert.ok(declIdx >= 0, "expected `let priorObservationsText = ''` in build-spec.js")
  assert.ok(!isGuardedBy(text, declIdx, /A\.memory_ref/),
    'the initial declaration of priorObservationsText must not itself be inside the args.memory_ref guard')
})
