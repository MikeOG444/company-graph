// spec-wi-c15-c12-c14-line-guards AC-16. Written from the Spec only.
//
// "A run without args.untracked_baseline ... The first Test Runner report of the run that carries an
// untracked array arrives ... That report becomes the baseline for the rest of the run: it yields no
// strays itself, and stray_baseline_source is 'first_report'. Later reports from any task are compared
// against it. If no runner ever reports untracked, stray_baseline_source is 'none' and stray_files is []."
//
// The second test below previously located its evidence by the first TEXTUAL occurrence, anywhere in the
// file, of a "stray_baseline_source ... 'none'" / "stray_files ... []" pattern. That kind of whole-file
// regex is satisfied just as easily by an unrelated declaration or a comment as by the actual default the
// run output reports, so it asserts nothing about behaviour. This version instead follows the same
// structural approach the AC-15 test in this same TestSet already uses: (1) find the CODE (non-comment,
// non-string, via the b5 code mask) occurrence of the stray_baseline_source field inside the run output,
// and the identifier assigned to it there; (2) trace that identifier back to the conditional expression
// that produces it (the same expression AC-15 confirms falls through to the literal 'args'), and confirm
// its final, unconditional fallback is the literal 'none' — the value when no baseline arg and no runner
// report ever set it to anything else; (3) confirm stray_files is declared as [] in code before the run
// output is built, and that the same run-output object (identified by its proximity to the
// stray_baseline_source field located in step 1, not by scanning the whole file) is what reports it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { codeMask } from './b5-wiring-helpers.js'

// The index just past the end of the physical source line containing `from`. This file's own style
// mixes semicolon-terminated and ASI (no-semicolon) statements, so a semicolon-seeking statement-end
// walk (as used elsewhere for a file that IS consistently semicolon-terminated) is not reliable here;
// a single declaration/assignment statement in this codebase's style never spans multiple lines at the
// point we care about (a `let x = a ? 'b' : 'c'` ternary), so the line is the right, and simpler, unit.
function lineEnd(text, from) {
  const nl = text.indexOf('\n', from)
  return nl < 0 ? text.length : nl
}

// First CODE (mask-true) match of `re` in `text`, or null.
function firstCodeMatch(text, mask, re) {
  re.lastIndex = 0
  let m
  while ((m = re.exec(text))) {
    if (mask[m.index]) return m
  }
  return null
}

test('AC-16: the run records "first_report" as the baseline source when no args.untracked_baseline is given', () => {
  const text = readWorkflowText()
  assert.match(text, /['"`]first_report['"`]/, 'expected the literal baseline-source value "first_report"')
})

test('AC-16: with no runner ever reporting untracked, stray_baseline_source is "none" and stray_files is []', () => {
  const text = readWorkflowText()
  const mask = codeMask(text)

  // Locate the run output's stray_baseline_source field (a code occurrence, not a comment) and the
  // identifier it is assigned from there.
  const fieldMatch = firstCodeMatch(text, mask, /stray_baseline_source\s*:\s*(\w+)\b/g)
  assert.ok(fieldMatch, 'expected a code occurrence of the stray_baseline_source field in the run output')
  const varName = fieldMatch[1]

  // Find the FIRST code assignment/declaration of that same identifier in the file — its initial value,
  // before any later reassignment (e.g. to 'first_report' once a runner report arrives) can have touched
  // it. That initial value is what the identifier holds — and what the run output above therefore
  // reports — when no runner ever reports untracked at all.
  const declMatch = firstCodeMatch(text, mask, new RegExp(`\\b${varName}\\s*=[^=]`, 'g'))
  assert.ok(declMatch, `expected a code assignment of ${varName}`)
  assert.ok(declMatch.index < fieldMatch.index, `expected ${varName}'s declaration to precede the run output field`)

  const span = text.slice(declMatch.index, lineEnd(text, declMatch.index))

  // Its initial value must fall back to the literal 'none' whenever no baseline arg was supplied — the
  // value that survives untouched to the run output when no runner ever reports untracked either.
  assert.match(span, /:\s*['"`]none['"`]/,
    `expected ${varName}'s initial value to fall back to the literal "none", got:\n${span}`)

  // Confirm the ONLY other place this identifier is ever assigned a plain string literal (its
  // reassignment once a runner report arrives) sets it to 'first_report', not to some other value that
  // would make 'none' unreachable in practice.
  const reassignRe = new RegExp(`\\b${varName}\\s*=\\s*['"\`](\\w+)['"\`]`, 'g')
  let rm
  const literalAssignments = []
  while ((rm = reassignRe.exec(text))) {
    if (mask[rm.index] && rm.index !== declMatch.index) literalAssignments.push(rm[1])
  }
  for (const lit of literalAssignments) {
    assert.equal(lit, 'first_report',
      `expected ${varName}'s only reassignment away from its initial value to be to 'first_report', found '${lit}'`)
  }

  // stray_files: locate the run output's stray_files field the same structural way — via a code
  // occurrence of the field, not a whole-file scan for "[]" — and confirm the identifier it reports is
  // itself declared/initialized to [] in code, before the run output is built. That initial value is
  // what the field reports absent from any push ever happening (no runner ever reporting untracked).
  const strayFilesField = firstCodeMatch(text, mask, /stray_files\s*:\s*(\w+)\b/g)
  assert.ok(strayFilesField, 'expected a code occurrence of the stray_files field in the run output')
  const strayFilesVar = strayFilesField[1]

  const strayFilesDecl = firstCodeMatch(text, mask, new RegExp(`\\b${strayFilesVar}\\s*=\\s*\\[\\]`, 'g'))
  assert.ok(strayFilesDecl, `expected ${strayFilesVar} to be declared/initialized as [] in code`)
  assert.ok(strayFilesDecl.index < strayFilesField.index,
    `expected ${strayFilesVar} to be declared before the run output is built`)

  // Confirm the two fields (stray_baseline_source and stray_files) are reported together, in the same
  // run-output object, rather than the stray_files field located above belonging to some unrelated object.
  const between = text.slice(Math.min(strayFilesField.index, fieldMatch.index), Math.max(strayFilesField.index, fieldMatch.index))
  assert.ok(between.length < 400,
    'expected stray_baseline_source and stray_files to be reported close together, in the same run-output object')
})

test('AC-16: stray_baseline_source is a variable the run output actually returns, not just an internal literal', () => {
  const text = readWorkflowText()
  assert.match(text, /stray_baseline_source/, 'expected stray_baseline_source to appear in the run output')
})
