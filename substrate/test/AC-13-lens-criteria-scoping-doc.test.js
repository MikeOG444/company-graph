// AC-13: .claude/agents/lens-spec-conformance.md and .claude/agents/lens-correctness.md
// must both document that the lens judges only the acceptance criteria the task owns,
// that a sibling-owned criterion is never a finding, and that a finding about a test
// assertion carries target 'test' even when its location points at the code the
// assertion covers — while every pre-existing rule survives in substance (reject-by-
// default, at least three attempts, path:line location, dedupe_key format,
// touched_surfaces as a permission envelope in lens-spec-conformance.md, and its solo
// re-panelling paragraph).
//
// Written from spec-wi-owned-surfaces-boundary (.artifacts/build/t7/specs/spec-wi-owned-
// surfaces-boundary.json) only. Lands in substrate/test/ and runs under the repo's
// `npm test` (node --test "substrate/test/*.test.js").
//
// The target='test' check below matches AC-13's "then" clause as one connected
// statement (co-occurring within a bounded window, with the even-when/regardless
// qualifier tied specifically to location-vs-code) rather than as four independent
// substring checks anywhere in the file, so it cannot be satisfied by unrelated
// mentions of 'target', 'assertion', "'test'" or an unrelated "even when" clause
// elsewhere in the document, and cannot be satisfied by a narrower rule that
// exempts some test-assertion findings from carrying target 'test'.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  LENS_SPEC_CONFORMANCE_MD_PATH,
  LENS_CORRECTNESS_MD_PATH,
} from './t2-doc-paths.js'

const LENSES = [
  ['lens-spec-conformance.md', LENS_SPEC_CONFORMANCE_MD_PATH],
  ['lens-correctness.md', LENS_CORRECTNESS_MD_PATH],
]

for (const [name, filePath] of LENSES) {
  test(`AC-13: ${name} states the lens judges only the task's own criteria and a sibling-owned criterion is never a finding`, () => {
    const text = fs.readFileSync(filePath, 'utf8')

    // Must state the lens is bound to the task's own criteria_ids and judges nothing else.
    assert.match(text, /criteria_ids/, `${name} must reference criteria_ids`)
    assert.match(text, /\bown(s|ed)?\b/i, `${name} must state the criteria the task owns`)
    assert.match(text, /\bonly\b/i, `${name} must state the lens judges ONLY its own criteria`)

    // Must state a sibling-owned criterion is never a finding.
    assert.match(text, /sibling/i, `${name} must mention sibling tasks/criteria`)
    assert.match(
      text,
      /never\s+(be\s+|is\s+)?a\s+finding|not\s+.*a\s+finding/i,
      `${name} must state a sibling-owned criterion is never a finding`,
    )
  })

  test(`AC-13: ${name} states EVERY finding about a test assertion carries target 'test' even when its location points at the covered code`, () => {
    const text = fs.readFileSync(filePath, 'utf8')

    // AC-13's "then" clause is one connected claim — "a finding about a test
    // assertion carries target 'test' even when its location points at the
    // code the assertion covers" — not four independent facts that may live
    // in unrelated parts of the file. Checking each regex against the whole
    // document (as a prior version of this test did) would pass even if
    // 'target', 'assertion', "'test'" and an "even when" clause each occur
    // in unconnected sentences (e.g. 'target' describing touched_surfaces,
    // 'even when' belonging to the solo re-panelling rule). Require them to
    // co-occur within one bounded window so the match is actually the
    // combined statement AC-13 describes, and require that window's
    // "even when/regardless" clause to be the LOCATION-vs-code qualifier
    // AC-13 names — not some other, narrower condition (e.g. gating the
    // rule to only certain kinds of assertion defects) that the spec never
    // states and that would silently exempt some test-assertion findings
    // from carrying target 'test'.
    const WINDOW = 400
    const testValueRe = /['"]test['"]/g
    let sawCandidateWindow = false
    let ok = false
    let match
    while ((match = testValueRe.exec(text)) !== null) {
      sawCandidateWindow = true
      const start = Math.max(0, match.index - WINDOW)
      const end = Math.min(text.length, match.index + WINDOW)
      const window = text.slice(start, end)
      const hasTarget = /target/i.test(window)
      const hasAssertion = /assertion/i.test(window)
      // The "even when" (or regardless-of/despite) qualifier must itself be
      // about location pointing at the covered code, per AC-13's exact
      // wording, not about some other narrowing condition.
      const hasLocationQualifiedEvenWhen =
        /(even\s+(though|when)|regardless\s+of|despite)[\s\S]{0,120}(location)[\s\S]{0,120}(code|covers)/i.test(
          window,
        ) ||
        /(location)[\s\S]{0,120}(even\s+(though|when)|regardless\s+of|despite)[\s\S]{0,120}(code|covers)/i.test(
          window,
        )
      if (hasTarget && hasAssertion && hasLocationQualifiedEvenWhen) {
        ok = true
        break
      }
    }

    assert.ok(sawCandidateWindow, `${name} must state the target value 'test' somewhere`)
    assert.ok(
      ok,
      `${name} must state, as one connected statement, that a finding about a test assertion carries ` +
        `target 'test' even when its location points at the code the assertion covers — with the ` +
        `"even when/regardless" qualifier tied to location-vs-code, not to some other, spec-unstated ` +
        `narrowing (e.g. limited to specific kinds of assertion defects) that AC-13 does not permit`,
    )
  })

  test(`AC-13: ${name} keeps its pre-existing rules in substance`, () => {
    const text = fs.readFileSync(filePath, 'utf8')

    assert.match(text, /reject/i, `${name}: reject-by-default rule must still be present`)
    assert.match(text, /attempts/i, `${name}: the attempts rule must still be present`)
    assert.match(text, /three|3/i, `${name}: the "at least three attempts" rule must still be present`)
    assert.match(text, /location/i, `${name}: the location rule must still be present`)
    assert.match(text, /line/i, `${name}: the location rule must still require a line number`)
    assert.match(text, /path/i, `${name}: the location rule must still require a path`)
    assert.match(text, /dedupe_key/, `${name}: the dedupe_key format rule must still be present`)
  })
}

test("AC-13: lens-spec-conformance.md keeps touched_surfaces as a permission envelope and its solo re-panelling paragraph", () => {
  const text = fs.readFileSync(LENS_SPEC_CONFORMANCE_MD_PATH, 'utf8')

  assert.match(text, /touched_surfaces/, 'touched_surfaces rule must still be present')
  assert.match(text, /permission envelope|envelope/i, 'touched_surfaces must still be documented as a permission envelope')
  assert.match(text, /re-?panel(l)?ed?\s+alone/i, 'the solo re-panelling paragraph must still be present')
})
