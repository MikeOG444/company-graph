// Text-level checks for spec-wi-owned-surfaces-boundary: how boundary checking, scope
// binding and TEST-ONLY re-routing are wired into build-implement.js and fixer.md.
//
// Written from the spec (.artifacts/build/t7/specs/spec-wi-owned-surfaces-boundary.json)
// only, anchored on call sites, labels and comments that are already present at HEAD
// (565c52f) so the assertions track behaviour rather than incidental file layout.
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'
import { readWorkflowText, FIXER_MD_PATH, loadFixLoopDecisions } from './extract-fixloop.js'

const VALID_REASONS = ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro']

test('AC-4: boundaryCheck runs on the settled ChangeSet after the empty-diff resolution and before any verify-loop agent label', () => {
  const text = readWorkflowText()
  const settledIdx = text.indexOf('let changeSet1 = cs')
  assert.ok(settledIdx >= 0, 'expected the existing empty-diff resolution to still assign changeSet1')

  const boundaryIdx = text.indexOf('boundaryCheck(', settledIdx)
  assert.ok(boundaryIdx > settledIdx, 'boundaryCheck must be called on the settled ChangeSet, after the empty-diff loop resolves it')

  for (const label of ['`run:${task.id}', '`lens:', '`scope:', '`fix:']) {
    const idx = text.indexOf(label, settledIdx)
    if (idx >= 0) assert.ok(boundaryIdx < idx, `boundaryCheck must run before the first "${label}" agent label`)
  }
})

test('AC-4: a settled-ChangeSet boundary violation ends the task before the panel, with one Escalation naming the stray and its owning sibling', () => {
  const text = readWorkflowText()
  const settledIdx = text.indexOf('let changeSet1 = cs')
  const boundaryIdx = text.indexOf('boundaryCheck(', settledIdx)
  assert.ok(boundaryIdx > settledIdx)
  const firstLensIdx = text.indexOf('`lens:', settledIdx)
  const section = text.slice(boundaryIdx, firstLensIdx > 0 ? firstLensIdx : boundaryIdx + 3000)

  assert.match(section, /violation/, 'the violation verdict must be handled in this branch')
  assert.match(section, /passed:\s*false/, 'a boundary violation must return the task as passed:false, never reaching the panel')
  assert.match(section, /escalations\.push/, 'a boundary violation must push exactly one Escalation, the same way the existing escalate() path does')
  assert.ok(VALID_REASONS.some(r => section.includes(r)), 'the pushed Escalation must use one of the five existing reason values')
  assert.match(section, /owner|owns/i, 'the Escalation history must be built from the sibling that owns each straying path')
})

test('AC-5: an unowned touched surface on the settled ChangeSet proceeds into the panel and adds no agent call of its own', () => {
  const text = readWorkflowText()
  assert.match(text, /unowned/, 'the unowned verdict must be handled distinctly from violation')
  assert.doesNotMatch(text, /label:\s*`[^`]*unowned/i, 'the unowned outcome must not introduce its own agent() call')
})

test('AC-6: boundaryCheck runs again on each round\'s merged ChangeSet, after the merge: mechanical call replaces ctx.changeSet', () => {
  const text = readWorkflowText()
  const mergeCallIdx = text.indexOf('label: `merge:${task.id}:r${ctx.round}`')
  assert.ok(mergeCallIdx >= 0, 'expected the existing merge: mechanical call that produces the round\'s merged ChangeSet')
  const afterMerge = text.indexOf('ctx.changeSet = { ...merged', mergeCallIdx)
  assert.ok(afterMerge > mergeCallIdx, 'expected the existing assignment of the merged ChangeSet back onto ctx.changeSet')

  const boundaryCallIdxs = [...text.matchAll(/boundaryCheck\(/g)].map(m => m.index)
  assert.ok(boundaryCallIdxs.length >= 2, 'boundaryCheck must be called both on the settled ChangeSet and again on each round\'s merged ChangeSet')
  const roundBoundaryIdx = boundaryCallIdxs.find(i => i > afterMerge)
  assert.ok(roundBoundaryIdx !== undefined, 'a boundaryCheck( call must follow the merged ChangeSet replacing ctx.changeSet')

  const section = text.slice(roundBoundaryIdx, roundBoundaryIdx + 1500)
  assert.match(section, /violation/, 'a round-level violation must be checked the same way as the settled-ChangeSet check')
  assert.match(section, /passed:\s*false/, 'a round-level violation must end the task instead of starting another round')
})

test('AC-7: the empty-diff refusal can name a sibling recorded as straying into this task\'s owned surfaces, while the generic wording survives for the no-violation case', () => {
  const text = readWorkflowText()
  const whyIdx = text.indexOf('const why = ')
  assert.ok(whyIdx >= 0, 'expected the existing empty-diff refusal message builder')
  const section = text.slice(whyIdx, whyIdx + 1200)

  assert.match(section, /owned surfaces/, 'the existing generic wording must remain for the case with no recorded violation')
  assert.match(section, /stray/i, 'the refusal must be able to name a task recorded as straying into this task\'s owned surfaces')
})

test('AC-11: stripForeignFindings runs on the round\'s verdicts before dedupe and adjudicate, and records the drop in history', () => {
  const text = readWorkflowText()
  const stripIdx = text.indexOf('stripForeignFindings(')
  assert.ok(stripIdx >= 0, 'expected a stripForeignFindings( call site in the verify loop')

  const adjudicateIdx = text.indexOf('adjudicate(verdicts)')
  assert.ok(adjudicateIdx >= 0, 'expected the existing adjudicate(verdicts) call to still be present')
  assert.ok(stripIdx < adjudicateIdx, 'stripForeignFindings must run on the round\'s verdicts before they reach adjudicate')

  const dedupeIdx = text.indexOf('dedupe(verdicts.flatMap')
  if (dedupeIdx >= 0) {
    assert.ok(stripIdx < dedupeIdx, 'stripForeignFindings must run before findings are deduped, so a dropped finding never enters the deduped findings list or ctx.seen')
  }

  const section = text.slice(stripIdx, adjudicateIdx)
  assert.match(section, /history\.push/, 'ctx.history must gain a line naming the dropped criterion and its owning sibling')
})

test('AC-12: the shared lens prompt states the task\'s own criteria, names the sibling owning each remaining criterion, and still hides notes', () => {
  const text = readWorkflowText()
  assert.match(
    text,
    /const\s*\{\s*notes:\s*_hidden,\s*\.\.\.diffOnly\s*\}\s*=\s*ctx\.changeSet/,
    'ChangeSet.notes must still be destructured away before building lens prompts',
  )

  const lensFnIdx = text.indexOf('const lens = (name, focus')
  assert.ok(lensFnIdx >= 0, 'expected the existing shared lens prompt builder')
  const promptEnd = text.indexOf('const sealVerdict', lensFnIdx)
  assert.ok(promptEnd > lensFnIdx)
  const template = text.slice(lensFnIdx, promptEnd)

  // The scope note is BUILT above the builder and interpolated into the template, so the criterion is satisfied
  // by the EFFECTIVE prompt the lens receives, not by the template's own literal text. Assert the interpolation
  // first, then read the note's construction and assert the content requirements against both together.
  const noteName = (template.match(/\$\{(\w*[Ss]cope\w*)\}/) ?? [])[1]
  assert.ok(noteName, 'the lens prompt must interpolate a criteria-scope note')

  const noteIdx = text.indexOf(`const ${noteName} =`)
  assert.ok(noteIdx >= 0 && noteIdx < lensFnIdx, `${noteName} must be built before the shared lens prompt builder`)
  const noteEnd = text.indexOf('\n\n', noteIdx)
  const note = text.slice(noteIdx, noteEnd > noteIdx && noteEnd < lensFnIdx ? noteEnd : lensFnIdx)
  const prompt = note + template

  assert.match(prompt, /criteria_ids/, 'the prompt must state the task\'s own criteria_ids verbatim')
  assert.match(prompt, /sibling/i, 'the prompt must name the sibling task that owns each remaining criterion')
  assert.match(prompt, /never\s+a\s+finding|not\s+a\s+finding/i, 'the prompt must say a criterion this task does not own is never a finding')
  assert.match(prompt, /own(s|ed)?\s+(criteri|acceptance)/i, 'the prompt must say the task is judged only against its own criteria')
})

test('AC-15: routeFinding replaces isTestFinding at both the scope-slicer filter and the fixer dispatch', () => {
  const text = readWorkflowText()
  // The identifier may survive in comments that record what it was replaced BY; what must be gone is every
  // executable use of it. Forbidding the string outright would forbid documenting the replacement.
  assert.doesNotMatch(text, /function\s+isTestFinding\b/, 'isTestFinding must no longer be defined')
  assert.doesNotMatch(text, /isTestFinding\s*\(/, 'isTestFinding must no longer be called')

  // Both required sites must route through routeFinding, directly or through a local binding of it.
  const bound = text.match(/const\s+(\w+)\s*=\s*\(?\s*\w*\s*\)?\s*=>\s*routeFinding\(/)
  const routeNames = ['routeFinding', ...(bound ? [bound[1]] : [])]
  const usesRoute = (s) => routeNames.some(n => s.includes(`${n}(`))

  const filterIdx = text.indexOf('const codeFresh =')
  assert.ok(filterIdx >= 0, 'expected the scope-slicer filter that selects the code findings')
  assert.ok(usesRoute(text.slice(filterIdx, text.indexOf('\n', filterIdx))),
    'the scope-slicer filter must decide test-vs-code through routeFinding')

  const dispatchIdx = text.indexOf('const fixes = (await parallel(')
  assert.ok(dispatchIdx >= 0, 'expected the existing fixer dispatch')
  assert.ok(usesRoute(text.slice(dispatchIdx, dispatchIdx + 400)),
    'the fixer dispatch must decide test-vs-code through routeFinding')
})

test('AC-16: a code Fixer\'s TEST-ONLY outcome is kept out of applied and re-routed to the Test Author, distinct from DISPUTE', () => {
  const text = readWorkflowText()
  assert.match(text, /TEST-ONLY:/, 'the workflow must recognize the TEST-ONLY: prefix, distinct from DISPUTE:')
  assert.match(text, /fixOutcome\(/, 'the workflow must classify a fixer\'s notes with fixOutcome')

  // TEST-ONLY must be an outcome of its own, distinct from DISPUTE and from a normal applied fix.
  const { fixOutcome } = loadFixLoopDecisions()
  const testOnly = fixOutcome('TEST-ONLY: the assertion is wrong, the code is right')
  const dispute = fixOutcome('DISPUTE: the finding is wrong')
  const plain = fixOutcome('patched the handler')
  assert.notEqual(testOnly, dispute, 'TEST-ONLY must classify differently from DISPUTE')
  assert.notEqual(testOnly, plain, 'TEST-ONLY must not classify as a normal applied fix')

  // `applied` selects BY that outcome, so TEST-ONLY and DISPUTE are excluded by construction rather than by a
  // second filter — what matters is what the filter selects, not which literals sit near it in the source.
  const appliedIdx = text.indexOf('const applied = fixes.filter(')
  assert.ok(appliedIdx >= 0, 'expected the existing applied-fixes filter')
  const appliedLine = text.slice(appliedIdx, text.indexOf('\n', appliedIdx))
  assert.match(appliedLine, /fixOutcome\([^)]*\)\s*===\s*'applied'/,
    'applied must select only fixes whose fixOutcome is "applied", excluding TEST-ONLY and DISPUTE by construction')
  assert.equal(plain, 'applied', 'a normal fix must classify as the exact value that filter selects')
  assert.notEqual(testOnly, 'applied', 'a TEST-ONLY fix must never be counted in applied, the same way a DISPUTE fix never is')

  const testfixLabels = [...text.matchAll(/label:\s*`testfix:/g)]
  assert.ok(testfixLabels.length >= 1, 'the TEST-ONLY re-route must use the existing testfix: label prefix')
})

test('AC-16: fixer.md documents the TEST-ONLY outcome as distinct from DISPUTE and states when to use it', () => {
  const fixerText = fs.readFileSync(FIXER_MD_PATH, 'utf8')
  assert.match(fixerText, /TEST-ONLY/, 'fixer.md must document the TEST-ONLY outcome')
  assert.match(fixerText, /DISPUTE/, 'fixer.md must still document DISPUTE, distinct from TEST-ONLY')
  assert.match(fixerText, /test\s+assertion|test\s+itself|the\s+test\b/i, 'fixer.md must say TEST-ONLY is for a defect in the test assertion, not the implementation')
})

test('AC-18: contracts.schema.json is untouched by this work except Finding — the Escalation reason enum still has exactly its five existing values', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'contracts.schema.json'), 'utf8'))
  assert.deepEqual(schema.$defs.Escalation.properties.reason.enum, VALID_REASONS)
})

test('AC-18: the only new agent() call sites are inside the boundary-violation branch (escalate:) and the TEST-ONLY re-route (testfix:)', () => {
  const text = readWorkflowText()
  const escalateLabels = [...text.matchAll(/label:\s*`escalate:/g)]
  assert.ok(escalateLabels.length >= 1, 'the boundary-violation branch must reuse the existing escalate: label prefix')
  const testfixLabels = [...text.matchAll(/label:\s*`testfix:/g)]
  assert.ok(testfixLabels.length >= 1, 'the TEST-ONLY re-route must use the existing testfix: label prefix')

  // Every agent() label in the file must use one of the prefixes already present at HEAD, or one of the two this
  // work is permitted to add (escalate:, testfix: — both of which already exist for a different purpose).
  const KNOWN_PREFIXES = new Set([
    'gate', 'checkout', 'impl', 'tests', 'rediff', 'escalate', 'canary',
    'run', 'lens', 'tiebreak', 'scope', 'fix', 'testfix', 'dispute', 'merge', 'integrate',
  ])
  const allPrefixes = [...text.matchAll(/label:\s*`([a-zA-Z_]+):/g)].map(m => m[1])
  for (const p of allPrefixes) {
    assert.ok(KNOWN_PREFIXES.has(p), `unexpected new agent label prefix "${p}" — AC-18 permits no new label prefix beyond escalate: and testfix:`)
  }
})
