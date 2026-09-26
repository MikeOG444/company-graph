// spec-wi-b8-tests-run-the-task-code AC-12. Written from the Spec only.
//
// "The diff of this change. Lens verdict derivation (normalizeVerdict, adjudicate), the judges, testValidity,
// and every other workflow file are compared with the base. None of them changed."
//
// The BASELINE text below is transcribed from .claude/workflows/build-implement.js and the other
// .claude/workflows/*.js files as they stood going into this work item (the pre-task commit) — the only way a
// test can assert "unchanged" after the fact, exactly the technique substrate/test/b6-regression-baseline.test.js
// already uses for the same normalizeVerdict/adjudicate functions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readWorkflowText } from './extract-fixloop.js'

const REPO = process.cwd()

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

const BASELINE_TEST_VALIDITY = `function testValidity(facts) {
  const f = facts ?? {}
  const is = (v) => v === true
  const locatesByFirstOccurrence = is(f.locates_by_first_occurrence)
  const requiresUnquotedLiteral = is(f.requires_unquoted_literal)
  const failsOnBaseSameReason = is(f.fails_on_base_same_reason)
  const namesCriterionBehaviour = is(f.names_criterion_behaviour)
  if (locatesByFirstOccurrence || requiresUnquotedLiteral) return 'test_defect'
  if (failsOnBaseSameReason && !namesCriterionBehaviour) return 'test_defect'
  if (namesCriterionBehaviour && !failsOnBaseSameReason) return 'code_defect'
  return 'unclear'
}`

// Pre-task sha256 of every OTHER workflow file (everything besides build-implement.js, the one surface this
// work item touches, per touched_surfaces).
const BASELINE_OTHER_WORKFLOW_HASHES = {
  'build-reentry.js': '2138be913df0179ceeed71bf60862ad21bd001364e9095d0bdeb7d0384a93d3b',
  'build-spec.js': '70af514c1ab9de41f39ec4b137c88ca5026bc4fd2259e559780e806ab3097590',
  'create-project.js': '567a58cdfb5074c0f4fe48347e08dff12088222d60abfdaddf086111d7133060',
  'deploy.js': 'dd68bfba792f1ee9646258e748a1a340e859a13109706351cfe0c3c57604a0f1',
  'improve-analyze.js': '5b1eeda996e0cde2e5b76b21e9e530e0a8cab8ba4ec647766bd9d22af3aea2e1',
  'launch.js': 'af291894fee896ee2404c0dda8e994468a73c5f81e4231072dba58c46c05c53f',
  'maintain-triage.js': '5953356f01d82f214b4a4be6495da3009351b3aefe974e1f2b17d5703636fa2f',
  'memory-roll.js': '846507fbb93218616a484daa383b51e264459339512ecb3acbe569ae15a72f87',
}

test('AC-12: normalizeVerdict is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_NORMALIZE_VERDICT), 'normalizeVerdict must be unchanged; lens verdict derivation is out of scope for this work item')
})

test('AC-12: adjudicate is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_ADJUDICATE), 'adjudicate must be unchanged; lens verdict derivation is out of scope for this work item')
})

test('AC-12: testValidity is byte-for-byte unchanged from its pre-task baseline', () => {
  const text = readWorkflowText()
  assert.ok(text.includes(BASELINE_TEST_VALIDITY), 'testValidity (the B6 validity detector\'s classification) must be unchanged, per this work item\'s own exclusions')
})

test('AC-12: no workflow file other than build-implement.js changed', () => {
  for (const [name, hash] of Object.entries(BASELINE_OTHER_WORKFLOW_HASHES)) {
    const filePath = path.join(REPO, '.claude', 'workflows', name)
    const text = fs.readFileSync(filePath, 'utf8')
    const actual = crypto.createHash('sha256').update(text).digest('hex')
    assert.equal(actual, hash, `${name} must be byte-for-byte unchanged; this work item touches only .claude/workflows/build-implement.js`)
  }
})
