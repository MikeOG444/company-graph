// spec-wi-c15-c12-c14-line-guards AC-12. Written from the Spec only.
//
// "There is exactly one agent() call with label 'gate:spec_gate'. It sits inside a loop that runs at most
// twice, re-invoked only when verifyGate returns retry: true on the first read. The build proceeds only on
// ok: true. Otherwise it returns { refused: true, reason, provenance }, and the reason contains the gate_id
// and the names of the failed_fields."
//
// Locating the label by `text.search(...)` (first textual occurrence in the whole file) is unsound: the
// literal 'gate:spec_gate' can appear in a comment, in the prompt text passed to agent(), or anywhere else
// well before or after the actual agent() call it labels, and `enclosingFunction` on that wrong index would
// then inspect the wrong function entirely. Instead: find every textual occurrence of the label, keep only
// the ones that fall inside the ARGUMENT LIST of an actual agent() call (via callSites + callSpan), and
// require there to be exactly one such call. Every other assertion is then anchored to that call's own
// enclosing function, not to a raw string search.
//
// Locating the loop that wraps the call is likewise not a job for `text.lastIndexOf('for (', callStart)`:
// the nearest preceding occurrence of that literal text is not necessarily still open at `callStart` (an
// earlier, already-closed sibling loop would satisfy it just as well), and it says nothing about what the
// loop actually bounds. `enclosingLoop` below finds every for/while header structurally (skipping strings,
// templates and comments via the shared code mask), brace-matches each one's body, and keeps only the
// headers whose body actually contains the call site. The bound itself is checked by evaluating the for-loop
// header's arithmetic (init/condition/step) rather than requiring one exact spelling of the comparison — the
// Spec says "runs at most twice", it never quotes a literal like `< 2`, so `attempt <= 2` starting at 1 must
// pass exactly as `attempt < 2` starting at 0 would.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { callSites, codeMask, matchBrace } from './b5-wiring-helpers.js'
import { callSpan } from './k21-call-span-helper.js'

// Every agent() call site whose argument list contains the literal 'gate:spec_gate' as its label.
function gateSpecGateAgentCalls(text) {
  const agentSites = callSites(text, 'agent')
  const labelRe = /['"`]gate:spec_gate['"`]/g
  const labelIdxs = []
  let m
  while ((m = labelRe.exec(text))) labelIdxs.push(m.index)

  const owning = []
  for (const site of agentSites) {
    const span = callSpan(text, site)
    if (labelIdxs.some(idx => idx > span.argsStart && idx < span.end)) owning.push(span)
  }
  return owning
}

// Every for/while loop in `text`, located structurally: header found via the code mask (so a mention inside
// a string/comment/template can't match), body found by brace-matching the block that follows the header's
// closing paren. Returns { kind, headerText, bodyStart, bodyEnd }.
function findLoops(text) {
  const mask = codeMask(text)
  const out = []
  const re = /\b(for|while)\s*\(/g
  let m
  while ((m = re.exec(text))) {
    const at = m.index
    if (!mask[at]) continue
    let i = at + m[0].length, depth = 1
    while (depth && i < text.length) {
      if (mask[i]) { if (text[i] === '(') depth++; else if (text[i] === ')') depth-- }
      i++
    }
    const headerText = text.slice(at + m[0].length, i - 1)
    let j = i
    while (j < text.length && /\s/.test(text[j])) j++
    if (text[j] !== '{') continue // only block-bodied loops are in scope here
    const bodyStart = j
    const bodyEnd = matchBrace(text, j)
    out.push({ kind: m[1], headerStart: at, headerText, bodyStart, bodyEnd })
  }
  return out
}

// The innermost loop (by smallest body span) whose body contains `idx`.
function enclosingLoop(text, idx) {
  const hits = findLoops(text).filter(l => l.bodyStart < idx && idx < l.bodyEnd)
  if (!hits.length) return null
  return hits.reduce((a, b) => (b.bodyEnd - b.bodyStart < a.bodyEnd - a.bodyStart ? b : a))
}

// Every `{ ... }` block in `text`, located structurally: every '{' that is real code (per the shared code
// mask, so a brace inside a string/comment/template can't match) is brace-matched to its close. Works for
// any block — function bodies, if/for/while bodies, or a bare `{ }` scope — which matters here because
// build-implement.js is a top-level workflow script with no wrapping function to anchor on (CLAUDE.md rule 9).
function findBlocks(text) {
  const mask = codeMask(text)
  const out = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' && mask[i]) {
      try { out.push({ bodyStart: i, bodyEnd: matchBrace(text, i) }) } catch { /* unbalanced under a regex/template false-positive; skip */ }
    }
  }
  return out
}

// The innermost block (by smallest span) that STRICTLY CONTAINS `idx` without itself starting at `idx` (so
// passing a loop's own header index finds the block the loop lives in, not the loop's own body).
function enclosingBlock(text, idx) {
  const hits = findBlocks(text).filter(b => b.bodyStart < idx && idx < b.bodyEnd)
  if (!hits.length) return null
  return hits.reduce((a, b) => (b.bodyEnd - b.bodyStart < a.bodyEnd - a.bodyStart ? b : a))
}

// For a `for (init; cond; step)` header, the number of times the loop body runs, computed arithmetically
// (not by matching one exact spelling of the comparison). Returns null if the header isn't a simple numeric
// counting loop.
function forLoopIterationCount(headerText) {
  const parts = headerText.split(';')
  if (parts.length !== 3) return null
  const [initPart, condPart, stepPart] = parts.map(s => s.trim())
  const initMatch = initPart.match(/=\s*(-?\d+)\s*$/)
  const condMatch = condPart.match(/([A-Za-z_$][\w$]*)\s*(<=|<|>=|>)\s*(-?\d+)/)
  if (!initMatch || !condMatch) return null
  let step
  if (/\+\+/.test(stepPart)) step = 1
  else if (/--/.test(stepPart)) step = -1
  else {
    const stepMatch = stepPart.match(/\+=\s*(-?\d+)/) || stepPart.match(/-=\s*(-?\d+)/)
    if (!stepMatch) return null
    step = stepPart.includes('+=') ? Number(stepMatch[1]) : -Number(stepMatch[1])
  }
  let v = Number(initMatch[1])
  const bound = Number(condMatch[3])
  const op = condMatch[2]
  const passes = (val) => (op === '<' ? val < bound : op === '<=' ? val <= bound : op === '>' ? val > bound : val >= bound)
  let count = 0
  while (passes(v) && count < 1000) { count++; v += step }
  return count
}

test('AC-12: exactly one agent() call site is labelled gate:spec_gate, sitting inside a loop bounded to at most two iterations', () => {
  const text = readWorkflowText()
  const calls = gateSpecGateAgentCalls(text)
  assert.equal(calls.length, 1,
    'expected exactly one agent() call site labelled gate:spec_gate (re-invoked via a loop, not a new call site)')

  const loop = enclosingLoop(text, calls[0].nameStart)
  assert.ok(loop, 'expected the single agent() call to sit inside a loop construct (for/while), found structurally')

  if (loop.kind === 'for') {
    const count = forLoopIterationCount(loop.headerText)
    assert.ok(count !== null, `expected a simple counting for-loop header, got: ${loop.headerText}`)
    assert.ok(count <= 2, `expected the loop to run at most twice, computed ${count} iterations from: ${loop.headerText}`)
  } else {
    // while-loop: the Spec never quotes an exact comparison spelling, so accept any comparison against 2.
    assert.match(loop.headerText, /\b2\b/, `expected the while-loop condition to bound iterations against 2, got: ${loop.headerText}`)
    assert.match(loop.headerText, /<=?|>=?/, `expected a comparison operator in the while-loop condition, got: ${loop.headerText}`)
  }
})

test('AC-12: verifyGate is called (at least once) within the same loop that runs the gate:spec_gate check', () => {
  const text = readWorkflowText()
  const calls = gateSpecGateAgentCalls(text)
  assert.equal(calls.length, 1, 'expected exactly one agent() call site labelled gate:spec_gate')

  // build-implement.js is a top-level workflow script (CLAUDE.md rule 9: no wrapping function, no import/
  // fs/shell in the script body), so `enclosingFunction` — which only recognizes `function name(...) {}`
  // declarations — has nothing to find here and throws. The loop the Spec describes ("It sits inside a
  // loop that runs at most twice, re-invoked only when verifyGate returns retry: true on the first read")
  // is the correct, structurally-locatable scope: verifyGate must be called somewhere the retry decision can
  // see the freshly read result, i.e. inside that same loop body.
  const loop = enclosingLoop(text, calls[0].nameStart)
  assert.ok(loop, 'expected the single agent() call to sit inside a loop construct (for/while), found structurally')
  const verifyGateSites = callSites(text, 'verifyGate', loop.bodyStart, loop.bodyEnd)
  assert.ok(verifyGateSites.length >= 1,
    'expected verifyGate to be called, within the loop that makes the gate:spec_gate agent() call, to check the read')
})

test('AC-12: on any non-retryable failure (or a still-failing retry), the check refuses, naming the gate_id and the failed fields', () => {
  const text = readWorkflowText()
  const calls = gateSpecGateAgentCalls(text)
  assert.equal(calls.length, 1, 'expected exactly one agent() call site labelled gate:spec_gate')

  const loop = enclosingLoop(text, calls[0].nameStart)
  assert.ok(loop, 'expected the single agent() call to sit inside a loop construct (for/while), found structurally')

  // The refusal that follows a failed/exhausted retry is emitted once the loop has run its course, so it need
  // not live inside the loop body itself — but it must live strictly AFTER the loop's own closing brace, within
  // the block that directly encloses the loop: this file also contains an unrelated, earlier refusal (no
  // gate_id supplied at all, before any read is attempted) that also says `refused: true` / `reason:` but has
  // nothing to do with verifyGate's retry outcome. That earlier refusal sits in the SAME enclosing block as the
  // loop (both are nested inside the outer "spec is gated" if-statement), so slicing the whole enclosing block
  // (bodyStart..bodyEnd) would include that earlier, unrelated refusal right alongside the real one and the
  // assertions below would pass just as happily whether or not the real post-retry refusal exists at all —
  // exactly the first-textual-occurrence failure mode this file's helpers exist to avoid. Slicing from the
  // loop's own closing brace onward excludes every refusal written before the retry loop runs, so only the
  // refusal that can actually see `verdict` (computed inside the loop) can satisfy these assertions.
  const parent = enclosingBlock(text, loop.headerStart)
  assert.ok(parent, 'expected the loop to sit inside some enclosing block')
  assert.ok(loop.bodyEnd <= parent.bodyEnd, 'expected the loop to end before its enclosing block does')
  const block = text.slice(loop.bodyEnd, parent.bodyEnd)
  const verifyGateSites = callSites(text, 'verifyGate', loop.bodyStart, loop.bodyEnd)
  assert.ok(verifyGateSites.length >= 1, 'expected verifyGate to be called inside the loop to produce the failed_fields the refusal names')

  assert.match(block, /refused\s*:\s*true/, 'expected a refused: true return on failure')
  assert.match(block, /reason\s*:/, 'expected a reason field on the refusal')
  assert.match(block, /failed_fields/, 'expected the refusal to reference failed_fields')
  assert.match(block, /gate_id/, 'expected the refusal to reference gate_id')
  assert.match(block, /provenance/, 'expected the refusal to still carry provenance')
})
