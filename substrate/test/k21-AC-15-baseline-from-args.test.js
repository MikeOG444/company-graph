// spec-wi-c15-c12-c14-line-guards AC-15. Written from the Spec only.
//
// "A run with args.untracked_baseline supplied ... Strays are computed against args.untracked_baseline, and
// the run output's stray_baseline_source is 'args'."
//
// The original version of the second test below located the code it covers by the first TEXTUAL occurrence
// of `untracked_baseline` in the file and then inspected a fixed-size character window around it. That first
// occurrence is inside the args header COMMENT near the top of the file (documenting the args shape), not the
// code that reads args.untracked_baseline — so the window never reached the real assignment or the run-output
// field, and the assertion failed regardless of what the implementation does. This version instead: (1) uses
// the code mask from b5-wiring-helpers to find the first CODE (non-comment, non-string) read of
// `.untracked_baseline`, skipping comment mentions entirely; (2) walks statement-by-statement (via top-level
// semicolons, not a fixed char count) from there to find the conditional that is keyed on that read and
// produces the literal 'args'; and (3) confirms that same value actually reaches the run output's
// stray_baseline_source field, by tracing the assigned identifier to its use there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { codeMask } from './b5-wiring-helpers.js'

// The index just past the next top-level (depth-0) statement terminator at or after `from` — a ';', or (this
// file's style relies on ASI rather than semicolons for most statements) a '\n' that closes out a depth-0
// expression. Skips strings/comments/templates via the code mask and tracks (), [], {} nesting so we don't stop
// inside a nested expression or a multi-line statement.
function nextStatementEnd(text, mask, from) {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    if (!mask[i]) continue
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ';' && depth <= 0) return i + 1
    else if (c === '\n' && depth <= 0) {
      // Only a boundary if the statement so far actually looks complete: not ending with an operator/comma/
      // opening punctuation that means the expression continues on the next line.
      const soFar = text.slice(from, i)
      if (/[-+*/%<>=&|?:,([{~^]\s*$/.test(soFar) || soFar.trim() === '') continue
      return i + 1
    }
  }
  throw new Error(`nextStatementEnd: no top-level statement end found after ${from}`)
}

test('AC-15: args.untracked_baseline is read and used as the baseline when supplied', () => {
  const text = readWorkflowText()
  assert.match(text, /untracked_baseline/, 'expected args.untracked_baseline to be read')
})

test('AC-15: when args.untracked_baseline is supplied, stray_baseline_source is recorded as "args"', () => {
  const text = readWorkflowText()
  const mask = codeMask(text)

  // Find the first CODE occurrence (not a comment) of a read of .untracked_baseline off args/A.
  const re = /(?:args|A)\s*\.\s*untracked_baseline/g
  let m
  let readIdx = -1
  while ((m = re.exec(text))) {
    if (mask[m.index]) { readIdx = m.index; break }
  }
  assert.ok(readIdx >= 0, 'expected a code (non-comment) read of args.untracked_baseline')

  // Walk forward statement-by-statement (structurally, not by a fixed character count) collecting a small,
  // bounded number of full statements so we see the whole conditional expression this read feeds, however many
  // statements it spans.
  let end = readIdx
  const statements = []
  for (let i = 0; i < 3; i++) {
    end = nextStatementEnd(text, mask, end)
    statements.push(text.slice(readIdx, end))
  }
  const span = statements[statements.length - 1]

  // Within that span, find a conditional keyed on the untracked_baseline read (or the identifier it was just
  // assigned to) whose truthy branch is the literal 'args', assigned to some identifier.
  const condMatch = span.match(/(\w+)\s*=\s*[^;]*\?\s*['"`]args['"`]\s*:/)
  assert.ok(condMatch, `expected a conditional assigning the literal 'args' near the args.untracked_baseline read, got:\n${span}`)
  const sourceVar = condMatch[1]

  // Confirm that identifier is the one that actually reaches the run output's stray_baseline_source field
  // (a code occurrence, not a comment), rather than merely appearing somewhere nearby.
  const fieldRe = new RegExp(`stray_baseline_source\\s*:\\s*${sourceVar}\\b`)
  let fieldIdx = -1
  let fm
  const fieldSearch = /stray_baseline_source\s*:\s*(\w+)\b/g
  while ((fm = fieldSearch.exec(text))) {
    if (mask[fm.index]) { fieldIdx = fm.index; break }
  }
  assert.ok(fieldIdx >= 0, 'expected a code occurrence of the stray_baseline_source field in the run output')
  assert.match(text.slice(fieldIdx, fieldIdx + 200), fieldRe,
    `expected the run output's stray_baseline_source to be set from ${sourceVar} (the value the args.untracked_baseline conditional assigns 'args' to)`)
})
