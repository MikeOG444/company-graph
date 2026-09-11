// Pure-function tests for spec-wi-owned-surfaces-boundary's nine new fix-loop decision
// functions (surfaceRef, withinOwned, boundaryCheck, criteriaScope, citedCriteria,
// isForeignCriterionFinding, stripForeignFindings, routeFinding, fixOutcome), plus the
// AC-1 shape check that the sentinel block now exposes all seventeen decision functions
// (the eight that already existed, unchanged, plus these nine).
//
// Written from the spec (.artifacts/build/t7/specs/spec-wi-owned-surfaces-boundary.json)
// only: every scenario below is transcribed from the acceptance criteria's own
// given/when/then, not from reading the implementation. Lands in substrate/test/ and
// runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock, loadFixLoopDecisions } from './extract-fixloop.js'

// A minimal, contract-shaped Finding (see contracts.schema.json #/$defs/Finding).
function finding(overrides) {
  return {
    id: 'f0', lens: 'security', severity: 'medium',
    location: 'toy/src/app.js:1', claim: 'claim', evidence: 'evidence',
    dedupe_key: 'k0', status: 'open',
    ...overrides,
  }
}

// A minimal, contract-shaped Verdict (see contracts.schema.json #/$defs/Verdict).
function verdict(lens, findings) {
  return {
    lens, change_set_id: 'cs1', verdict: findings.length ? 'fail' : 'pass',
    attempts: ['a', 'b', 'c'], findings, confidence: 0.9,
    provenance: { node: `lens:${lens}`, executor: 'ai_agent', method: 'dark_factory', model: 'haiku', run_id: 'r', created_at: 't' },
  }
}

test('AC-1: the sentinel block still exposes the eight existing decision functions, plus exactly nine new ones named verbatim', () => {
  const decisions = loadFixLoopDecisions()
  const EXISTING = ['scopeOf', 'scopeTargets', 'nextLenses', 'lensesToRun', 'roundBudget', 'taskCeiling', 'emptyDiffAction', 'shouldEscalate']
  const NEW = ['surfaceRef', 'withinOwned', 'boundaryCheck', 'criteriaScope', 'citedCriteria',
    'isForeignCriterionFinding', 'stripForeignFindings', 'routeFinding', 'fixOutcome']
  assert.deepEqual(Object.keys(decisions).sort(), [...EXISTING, ...NEW].sort())
  for (const name of [...EXISTING, ...NEW]) assert.equal(typeof decisions[name], 'function', `${name} must be a function`)
})

test('AC-1: the extractable block still contains no runtime handle, agent call or await', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1, 'BEGIN sentinel line must appear exactly once')
  assert.equal(endCount, 1, 'END sentinel line must appear exactly once')
  assert.ok(block && block.trim().length > 0)
  for (const token of ['args', 'agent(', 'parallel(', 'pipeline(', 'phase(', 'log(', 'budget.']) {
    assert.ok(!block.includes(token), `the block must not contain "${token}"`)
  }
  assert.ok(!/\bawait\b/.test(block), 'the block must not contain await')
})

test('AC-2: surfaceRef strips a schema fragment, a leading "./" and a trailing "/"', () => {
  const { surfaceRef } = loadFixLoopDecisions()
  assert.equal(surfaceRef({ kind: 'schema', ref: 'contracts.schema.json#/$defs/Finding' }), 'contracts.schema.json')
  assert.equal(surfaceRef({ kind: 'path', ref: './substrate/ledger.js' }), 'substrate/ledger.js')
  assert.equal(surfaceRef({ kind: 'path', ref: 'substrate/test/' }), 'substrate/test')
})

test('AC-2: withinOwned matches an exact ref, a path under a directory-shaped owned ref, any ref under an exempt prefix, and rejects a sibling-prefix near-miss', () => {
  const { withinOwned } = loadFixLoopDecisions()
  const owned = ['substrate/ledger.js', 'substrate/test/']
  const exempt = ['.artifacts/']
  assert.equal(withinOwned('substrate/ledger.js', owned, exempt), true, 'exact match')
  assert.equal(withinOwned('substrate/test/new.test.js', owned, exempt), true, 'path under a directory-shaped owned ref')
  assert.equal(withinOwned('.artifacts/whatever/x.json', owned, exempt), true, 'any ref under an exempt prefix')
  assert.equal(withinOwned('substrate/testing/x.js', owned, exempt), false, 'a sibling-prefix near-miss must not match')
})

test('AC-3: boundaryCheck classifies a stray into a sibling as "violation", a stray into nobody as "unowned", and full containment as "clean" (the t5i shape)', () => {
  const { boundaryCheck } = loadFixLoopDecisions()
  const owned_surfaces = [{ kind: 'path', ref: 'substrate/' }]
  const siblings = [{ id: 't2', owned_surfaces: [{ kind: 'path', ref: 'ledger/' }] }]

  const violation = boundaryCheck({
    touched_surfaces: [
      { kind: 'path', ref: 'substrate/ledger.js' },
      { kind: 'path', ref: 'ledger/index.jsonl' },
      { kind: 'path', ref: 'README.md' },
    ],
    owned_surfaces, siblings, exempt_prefixes: [],
  })
  assert.equal(violation.verdict, 'violation')
  assert.deepEqual(violation.strays, [{ ref: 'ledger/index.jsonl', owner: 't2' }])
  assert.deepEqual(violation.unowned, ['README.md'])

  const onlyReadmeStrays = boundaryCheck({
    touched_surfaces: [{ kind: 'path', ref: 'substrate/ledger.js' }, { kind: 'path', ref: 'README.md' }],
    owned_surfaces, siblings, exempt_prefixes: [],
  })
  assert.equal(onlyReadmeStrays.verdict, 'unowned')
  assert.deepEqual(onlyReadmeStrays.unowned, ['README.md'])
  assert.deepEqual(onlyReadmeStrays.strays, [])

  const clean = boundaryCheck({
    touched_surfaces: [{ kind: 'path', ref: 'substrate/ledger.js' }],
    owned_surfaces, siblings, exempt_prefixes: [],
  })
  assert.equal(clean.verdict, 'clean')
  assert.deepEqual(clean.strays, [])
  assert.deepEqual(clean.unowned, [])
})

test('AC-8: criteriaScope reports the task\'s own criteria, maps sibling-owned remaining criteria, ignores tasks of a different spec, and lists unassigned criteria', () => {
  const { criteriaScope } = loadFixLoopDecisions()
  const t1 = { id: 't1', spec_id: 's1', criteria_ids: ['AC-1', 'AC-2'] }
  const t2 = { id: 't2', spec_id: 's1', criteria_ids: ['AC-12'] }
  const other = { id: 'o1', spec_id: 's2', criteria_ids: ['AC-3'] }
  const tasks = [t1, t2, other]

  const scope = criteriaScope({ task: t1, tasks, acceptance_ids: ['AC-1', 'AC-2', 'AC-3', 'AC-12', 'AC-99'] })
  assert.deepEqual(scope.owned, ['AC-1', 'AC-2'])
  assert.equal(scope.sibling_owner['AC-12'], 't2')
  assert.equal(scope.sibling_owner['AC-3'], undefined, 'a task of a different spec is not a sibling')
  assert.deepEqual(scope.unassigned, ['AC-99'])

  const noAcceptanceIds = criteriaScope({ task: t1, tasks })
  assert.deepEqual(noAcceptanceIds.unassigned, [], 'must degrade to an empty unassigned list, never throw, when acceptance_ids is absent')
})

test('AC-9: citedCriteria matches acceptance ids as whole tokens only, across claim, evidence and location', () => {
  const { citedCriteria } = loadFixLoopDecisions()
  const f = finding({
    location: 'toy/src/app.js:1',
    claim: 'AC-12 is not satisfied by this change',
    evidence: 'quotes AC-121 and xAC-1',
  })
  assert.deepEqual(citedCriteria(f, ['AC-1', 'AC-12', 'AC-121']).slice().sort(), ['AC-12', 'AC-121'].sort())
})

test('AC-10: isForeignCriterionFinding is true only for a finding whose sole citations are sibling-owned', () => {
  const { isForeignCriterionFinding } = loadFixLoopDecisions()
  const scope = { owned: ['AC-1', 'AC-2'], sibling_owner: { 'AC-12': 't2' }, unassigned: ['AC-50'] }

  assert.equal(isForeignCriterionFinding(finding({ claim: 'AC-12 fails here' }), scope), true, 'citing only sibling-owned AC-12')
  assert.equal(isForeignCriterionFinding(finding({ claim: 'AC-2 fails here' }), scope), false, 'citing owned AC-2')
  assert.equal(isForeignCriterionFinding(finding({ claim: 'nothing cited here' }), scope), false, 'citing no criterion id at all')
  assert.equal(isForeignCriterionFinding(finding({ claim: 'AC-1 and AC-12 both fail' }), scope), false, 'citing owned AC-1 and sibling AC-12 together')
  assert.equal(isForeignCriterionFinding(finding({ claim: 'AC-50 fails here' }), scope), false, 'citing only an unassigned criterion — nobody owns it')
})

test('AC-11: stripForeignFindings drops findings citing only sibling-owned criteria (the t2i mirror) and reports what it dropped', () => {
  const { stripForeignFindings } = loadFixLoopDecisions()
  const scope = { owned: ['AC-11'], sibling_owner: { 'AC-9': 't2' }, unassigned: [] }

  const foreignSpecFinding = finding({ id: 'f1', lens: 'spec_conformance', dedupe_key: 'sc-1', claim: 'AC-9 is violated' })
  const ownedCorrectnessFinding = finding({ id: 'f2', lens: 'correctness', dedupe_key: 'co-1', claim: 'AC-11 is violated' })
  const foreignCorrectnessFinding = finding({ id: 'f3', lens: 'correctness', dedupe_key: 'co-2', claim: 'AC-9 fails here too' })

  const specConformanceVerdict = verdict('spec_conformance', [foreignSpecFinding])
  const correctnessVerdict = verdict('correctness', [ownedCorrectnessFinding, foreignCorrectnessFinding])

  const { verdicts, dropped } = stripForeignFindings([specConformanceVerdict, correctnessVerdict], scope)

  const spec = verdicts.find(v => v.lens === 'spec_conformance')
  const corr = verdicts.find(v => v.lens === 'correctness')
  assert.deepEqual(spec.findings, [], 'spec_conformance must carry no defect once its only finding is dropped')
  assert.deepEqual(corr.findings.map(f => f.id), ['f2'], 'correctness keeps only the finding that cites an owned criterion')

  assert.equal(dropped.length, 2)
  const byKey = Object.fromEntries(dropped.map(d => [d.dedupe_key, d]))
  assert.equal(byKey['sc-1'].criterion, 'AC-9')
  assert.equal(byKey['sc-1'].sibling, 't2')
  assert.equal(byKey['co-2'].criterion, 'AC-9')
  assert.equal(byKey['co-2'].sibling, 't2')
})

test('AC-15: routeFinding decides by target when present, and by location only when target is absent', () => {
  const { routeFinding } = loadFixLoopDecisions()
  const opts = { tests_ref: '.artifacts/tests/t1/', artifact_dir: '.artifacts' }

  assert.equal(routeFinding({ target: 'test', location: 'src/app.js:10' }, opts), 'test',
    'target decides even when location points at code')
  assert.equal(routeFinding({ target: 'implementation', location: '.artifacts/tests/t1/foo.test.js:5' }, opts), 'code',
    'target decides even when location points under the artifact test dir')
  assert.equal(routeFinding({ location: '.artifacts/tests/t1/foo.test.js:3' }, opts), 'test',
    'no target: the existing tests_ref location rule decides')
  assert.equal(routeFinding({ location: 'src/app.js:20' }, opts), 'code',
    'no target and a code location: the existing location rule decides')
})

test('AC-16: fixOutcome reads the fixer\'s notes prefix: TEST-ONLY -> test_only, DISPUTE -> dispute, otherwise applied', () => {
  const { fixOutcome } = loadFixLoopDecisions()
  assert.equal(fixOutcome('TEST-ONLY: the assertion itself was wrong, not the implementation'), 'test_only')
  assert.equal(fixOutcome('DISPUTE: does not reproduce'), 'dispute')
  assert.equal(fixOutcome('fixed the null check'), 'applied')
  assert.equal(fixOutcome(undefined), 'applied')
})
