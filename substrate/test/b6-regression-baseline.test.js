// Regression test for spec-wi-b6-test-validity-before-blame AC-17: after this change, every test that
// passed before still passes; loadFixLoopDecisions still returns its seventeen existing functions
// (extended only additively, if at all); and normalizeVerdict, adjudicate, the dispute: and tiebreak: agent
// prompts and their derivation are byte-for-byte unchanged.
//
// The exact BYTE-FOR-BYTE baseline text below (BASELINE_NORMALIZE_VERDICT, BASELINE_ADJUDICATE,
// BASELINE_DISPUTE_LABEL, BASELINE_TIEBREAK_LABEL) is transcribed from .claude/workflows/build-implement.js
// as it stood going into this work item — the pre-existing, out-of-scope surface the spec's own exclusions
// list names verbatim ("The dispute judge and Tiebreak Judge: their prompts... How lens verdicts are
// derived... normalizeVerdict, adjudicate"). Recording that PRE-TASK baseline now, before this task's
// implementation lands, is the only way a test can assert "unchanged" after the fact; the same
// requirement is why loadFixLoopDecisions's own seventeen-function list is asserted below rather than
// merely trusted. This is baseline TEXT of an out-of-scope, already-existing surface, not a look at this
// task's own implementation.
//
// Lands in substrate/test/ and runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, loadFixLoopDecisions } from './extract-fixloop.js'

const EXISTING_SEVENTEEN = [
  'scopeOf', 'scopeTargets', 'nextLenses', 'lensesToRun', 'roundBudget', 'taskCeiling', 'emptyDiffAction', 'shouldEscalate',
  'surfaceRef', 'withinOwned', 'boundaryCheck', 'criteriaScope', 'citedCriteria', 'isForeignCriterionFinding',
  'stripForeignFindings', 'routeFinding', 'fixOutcome',
]

const BASELINE_NORMALIZE_VERDICT = `function normalizeVerdict(v, tag) {
  const defects = (v.findings ?? []).filter(f => !SPEC_LEVEL.test(String(f.claim)))
  const derived = defects.length ? 'fail' : 'pass'
  if (v.verdict !== derived) {
    log(\`\${tag} \${v.lens}: said \${v.verdict} but \${defects.length} defect(s) remain; recorded as \${derived}\`)
    return { ...v, verdict: derived }
  }
  return v
}`

const BASELINE_ADJUDICATE = `function adjudicate(panelVerdicts) {
  const veto = panelVerdicts.find(v => v.lens === VETO_LENS && v.verdict === 'fail')
  if (veto) return { result: 'fail', veto_by: veto.lens, split: false }
  const fails = panelVerdicts.filter(v => v.verdict === 'fail')
  if (!fails.length) return { result: 'pass', split: false }
  if (fails.every(v => v.confidence < LOW_CONFIDENCE)) return { result: null, split: true }
  return { result: 'fail', split: false }
}`

const BASELINE_DISPUTE_CALL = `agent(\`Rule on a disputed finding. Do not create, edit or delete any file, and do not run any command that changes
               the repository — you rule, you never patch. \${specText}. Finding: \${JSON.stringify(x.f)}. Fixer's dispute: \${x.notes}.
               UPHOLD only if the finding names a real defect in how the change implements the spec. OVERRULE if it objects to behavior the
               spec requires, asks for something the spec lists as out of scope, or describes an attack the change already blocks.\`,
          { label: \`dispute:\${task.id}:\${x.f.id}\`, model: MODEL.mid, ...AT('dispute'), schema: Ruling }))`

const BASELINE_TIEBREAK_CALL = `agent(\`Adjudicate a split review. Do not create, edit or delete any file, and do not run any
               command that changes the repository — you adjudicate, you never patch. Verdicts: \${JSON.stringify(verdicts)}. \${specText}. Change: \${JSON.stringify(diffOnly)}.\`,
        { label: \`tiebreak:\${task.id}:\${tag}\`, model: MODEL.strong, ...AT('tiebreak'), schema: Verdict })`

test('AC-17: loadFixLoopDecisions still returns every one of the seventeen existing decision functions (extended only additively, if at all)', () => {
  const decisions = loadFixLoopDecisions()
  for (const name of EXISTING_SEVENTEEN) {
    assert.equal(typeof decisions[name], 'function', `expected loadFixLoopDecisions() to still return ${name} as a function`)
  }
})

test('AC-17: normalizeVerdict is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_NORMALIZE_VERDICT), 'normalizeVerdict\'s source must be byte-for-byte unchanged from the pre-task baseline this work item is not permitted to touch')
})

test('AC-17: adjudicate is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_ADJUDICATE), 'adjudicate\'s source must be byte-for-byte unchanged from the pre-task baseline this work item is not permitted to touch')
})

test('AC-17: the dispute: agent call (prompt, label and schema) is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_DISPUTE_CALL), 'the dispute: agent call must be byte-for-byte unchanged — the dispute judge is out of scope for this work item')
})

test('AC-17: the tiebreak: agent call (prompt, label and schema) is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_TIEBREAK_CALL), 'the tiebreak: agent call must be byte-for-byte unchanged — the Tiebreak Judge is out of scope for this work item')
})
