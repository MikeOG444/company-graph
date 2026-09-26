// AC-10: runTask contains a call to changeScopedCriteria whose argument is derived from spec.acceptance,
// and the prompt of the agent() call labelled `tests:${task.id}` inside runTask interpolates that call's
// result (restricted to or alongside task.criteria_ids) and contains an instruction that a criterion whose
// THEN asserts something is unchanged, identical to before, or not added/removed relative to the base is
// verified by the verifier panel at build time and must NOT get a test.
//
// Call sites are located with substrate/test/b5-wiring-helpers.js (functionNamed / callSites /
// enclosingFunction), never by first textual occurrence of a name.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './k17-helpers.js'
import { functionNamed, callSites } from './b5-wiring-helpers.js'

// Balances parens from an opening '(' at `openIdx`, skipping string and template literal contents (a
// generic argument-list extractor, not a call-site finder — the CALL itself is already located via
// callSites()).
function matchParen(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++ }
      continue
    }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i + 1 }
  }
  throw new Error(`matchParen: unbalanced ( at ${openIdx}`)
}

test('AC-10: runTask calls changeScopedCriteria(spec.acceptance-derived) and wires its result into the tests: prompt', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const body = text.slice(rt.bodyStart, rt.bodyEnd)

  // changeScopedCriteria is CALLED inside runTask (not merely declared elsewhere).
  const calls = callSites(body, 'changeScopedCriteria')
  assert.ok(calls.length >= 1, 'expected runTask to call changeScopedCriteria')
  const callStart = calls[0]
  const openParen = body.indexOf('(', callStart)
  const callEnd = matchParen(body, openParen)
  const argText = body.slice(openParen + 1, callEnd - 1)
  assert.match(argText, /spec\.acceptance/, 'expected the changeScopedCriteria call argument to derive from spec.acceptance')

  // The variable the call result is bound to (const/let NAME = changeScopedCriteria(...)).
  const bindMatch = body.slice(0, callStart).match(/(?:const|let)\s+(\w+)\s*=\s*$/) ||
    body.slice(0, callStart).match(/(?:const|let)\s+(\w+)\s*=\s*[\s\S]{0,80}$/)
  assert.ok(bindMatch, 'expected changeScopedCriteria(...) to be assigned to a const/let binding')
  const varName = bindMatch[1]

  // Find the agent() call labelled `tests:${task.id}` inside runTask, via callSites (never indexOf on a
  // whole-file scan for the call itself), then contain-check the label against each candidate call's span.
  const agentCalls = callSites(body, 'agent')
  const labelIdx = body.indexOf('`tests:${task.id}`')
  assert.ok(labelIdx >= 0, 'expected a label literal `tests:${task.id}` inside runTask')
  let testsCallSpan = null
  for (const start of agentCalls) {
    const open = body.indexOf('(', start)
    const end = matchParen(body, open)
    if (labelIdx > start && labelIdx < end) { testsCallSpan = body.slice(start, end); break }
  }
  assert.ok(testsCallSpan, 'expected to find the agent() call whose options contain the tests: label')

  // Split the prompt (first argument) from the options object (which starts at `label:`), so the
  // interpolation and instruction-text checks below are about the PROMPT specifically.
  const optionsStart = testsCallSpan.search(/\{\s*label:/)
  assert.ok(optionsStart > 0, 'expected an options object starting with label: in the tests: agent() call')
  const promptPart = testsCallSpan.slice(0, optionsStart)

  // The prompt interpolates the changeScopedCriteria result (bound to varName above).
  const interpolates = new RegExp('\\$\\{[^}]*\\b' + varName + '\\b[^}]*\\}').test(promptPart)
  assert.ok(interpolates, `expected the tests: prompt to interpolate ${varName} (the changeScopedCriteria result)`)

  // The prompt also still names task.criteria_ids somewhere (restricted to or alongside it).
  assert.match(promptPart, /criteria_ids/, 'expected the tests: prompt to still reference task.criteria_ids')

  // The prompt instructs the Test Author not to write a test for a change-scoped criterion, verified by the
  // panel at build time.
  assert.match(promptPart, /verifier panel/i, 'expected the prompt to name the verifier panel')
  assert.match(promptPart, /unchanged|identical to before|not (?:be )?added|added\/removed|added or removed/i,
    'expected the prompt to describe the unchanged/identical/not-added-or-removed condition')
  assert.match(promptPart, /must not|do not|never/i, 'expected the prompt to instruct against writing such a test')
})
