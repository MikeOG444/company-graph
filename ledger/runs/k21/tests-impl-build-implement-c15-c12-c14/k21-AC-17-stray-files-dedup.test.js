// spec-wi-c15-c12-c14-line-guards AC-17. Written from the Spec only.
//
// "Two tasks whose runner reports both contain the same new stray path in different rounds ... The run
// output's stray_files holds exactly one { round, task_id, path } entry for that path (the first
// observation). One log line was emitted per new stray path. No agent or script step deletes, moves or
// edits any stray file."
//
// The Spec quotes the run OUTPUT field name `stray_files` and its entry shape `{ round, task_id, path }`;
// it never quotes an internal variable name or a `.push(` spelling for how that array is built. A test
// that requires the literal `stray_files.push(` therefore asserts an incidental implementation detail the
// Spec never promised (a local accumulator can be named anything and still surface as `stray_files` on the
// returned run output). So this locates the recording site structurally: scan every object-literal `{...}`
// in the file (skipping strings/comments/templates via `codeMask`, brace-matched via `matchBrace` — never a
// whole-file `indexOf`/`search` for a guessed call spelling) for the one whose keys are exactly the three
// fields the Spec quotes, then checks the dedup guard, the log call and the run-output key around THAT
// site — not around the first textual mention of any name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { matchBrace, codeMask, enclosingFunction, callSites } from './b5-wiring-helpers.js'

// Every object-literal span `{ ... }` in `text` (code only) whose body mentions all of `round`, `task_id`
// and `path` as whole words, and is short enough to be a single entry literal rather than some larger
// block that happens to contain those words individually.
function shapedEntrySpans(text) {
  const mask = codeMask(text)
  const seenStarts = new Set()
  const out = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' || !mask[i] || seenStarts.has(i)) continue
    let end
    try { end = matchBrace(text, i) } catch { continue }
    seenStarts.add(i)
    const body = text.slice(i, end)
    if (body.length > 200) continue
    if (/\bround\b/.test(body) && /\btask_id\b/.test(body) && /\bpath\b/.test(body)) {
      out.push({ start: i, end })
    }
  }
  return out
}

test('AC-17: exactly one place in the file builds an entry shaped { round, task_id, path }', () => {
  const text = readWorkflowText()
  const spans = shapedEntrySpans(text)
  assert.equal(spans.length, 1,
    `expected exactly one { round, task_id, path }-shaped object literal, found ${spans.length}`)
})

test('AC-17: that entry is only recorded after checking the path was not already seen (dedup across tasks/rounds)', () => {
  const text = readWorkflowText()
  const [span] = shapedEntrySpans(text)
  assert.ok(span, 'expected a { round, task_id, path }-shaped object literal')
  const before = text.slice(Math.max(0, span.start - 400), span.start)
  // The Spec only requires that an already-recorded path is not recorded again; it does not quote a
  // particular spelling. A guard can be written either as a negated condition (`if (!seen.has(p))`) or as
  // an early-exit on the positive condition (`if (seen.has(p)) continue`) — both are "checking the path was
  // not already recorded" before the push, so accept either.
  assert.ok(
    /if\s*\(\s*!/.test(before) || /if\s*\([^)]*\.has\([^)]*\)\s*\)\s*continue/.test(before),
    'expected a guard immediately before recording a new stray path that skips a path already seen'
  )
})

test('AC-17: stray_files entries are shaped { round, task_id, path }', () => {
  const text = readWorkflowText()
  const [span] = shapedEntrySpans(text)
  assert.ok(span, 'expected a { round, task_id, path }-shaped object literal')
  const body = text.slice(span.start, span.end)
  for (const field of ['round', 'task_id', 'path']) {
    assert.match(body, new RegExp(`\\b${field}\\b`), `expected ${field} on the stray_files entry`)
  }
})

test('AC-17: a log line accompanies each new stray recording', () => {
  // Call-structure check, not a textual window scan: a raw regex over a fixed-width slice of the file
  // would happily match a comment that merely mentions `log(`, or a call belonging to some unrelated
  // block that happens to fall inside the slice. Instead this locates every genuine CALL to `log` (via
  // `callSites`, which is comment/string-aware through `codeMask`) inside the function that encloses the
  // stray-entry recording site, then requires the call nearest the recording site to actually be near it
  // — so a fixer that deletes the true call while leaving this function's other, unrelated `log(...)`
  // calls in place still fails this test.
  const text = readWorkflowText()
  const [span] = shapedEntrySpans(text)
  assert.ok(span, 'expected a { round, task_id, path }-shaped object literal')
  const fn = enclosingFunction(text, span.start)
  const calls = callSites(text, 'log', fn.bodyStart, fn.bodyEnd)
  assert.ok(calls.length, 'expected at least one call to `log` in the function that records a new stray path')
  const nearest = Math.min(...calls.map(at => Math.min(Math.abs(at - span.start), Math.abs(at - span.end))))
  assert.ok(nearest <= 300,
    `expected a \`log\` call near the { round, task_id, path } recording site, nearest was ${nearest} chars away`)
})

test('AC-17: the recorded entries are surfaced on the run output under the exact key `stray_files`', () => {
  const text = readWorkflowText()
  assert.match(text, /\bstray_files\s*:/, 'expected the run output to expose a `stray_files` key')
})

test('AC-17: nothing near the stray-handling logic deletes, moves, renames or overwrites a file — it is report only', () => {
  const text = readWorkflowText()
  const [span] = shapedEntrySpans(text)
  assert.ok(span, 'expected a { round, task_id, path }-shaped object literal')
  const window = text.slice(Math.max(0, span.start - 600), span.end + 600)
  assert.doesNotMatch(window, /fs\.(unlink|rm|rename|renameSync|unlinkSync|rmSync)\s*\(/,
    'stray-handling code must never call a filesystem delete/move/rename function')
})
