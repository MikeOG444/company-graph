// Tests for spec-wi-opp-p5-4's seven pure fix-loop decision functions
// (scopeOf, scopeTargets, nextLenses, lensesToRun, roundBudget, taskCeiling,
// shouldEscalate). Written from the spec only: every scenario below is transcribed
// from the acceptance criteria's own given/when/then, not from reading the
// implementation. Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock, loadFixLoopDecisions } from './extract-fixloop.js'

const LENSES3 = ['spec_conformance', 'security', 'correctness']

// A minimal, contract-shaped Finding (see contracts.schema.json #/$defs/Finding).
function finding(overrides) {
  return {
    id: 'f0', lens: 'security', severity: 'medium',
    location: 'toy/src/app.js:1', claim: 'claim', evidence: 'evidence',
    dedupe_key: 'k0', status: 'open',
    ...overrides,
  }
}

test('AC-1: the sentinel block extracts exactly the seven pure decision functions with no runtime handles', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1, 'BEGIN sentinel line must appear exactly once')
  assert.equal(endCount, 1, 'END sentinel line must appear exactly once')
  assert.ok(block && block.trim().length > 0, 'a non-empty block must be extractable between the sentinels')

  let result
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    result = new Function(block + '\nreturn { scopeOf, scopeTargets, nextLenses, lensesToRun, roundBudget, taskCeiling, shouldEscalate }')()
  }, 'evaluating the block with new Function must not throw')

  assert.deepEqual(
    Object.keys(result).sort(),
    ['lensesToRun', 'nextLenses', 'roundBudget', 'scopeOf', 'scopeTargets', 'shouldEscalate', 'taskCeiling'].sort(),
  )
  for (const [name, fn] of Object.entries(result)) {
    assert.equal(typeof fn, 'function', `${name} must be a function`)
  }

  for (const token of ['args', 'agent(', 'parallel(', 'pipeline(', 'phase(', 'log(', 'budget.']) {
    assert.ok(!block.includes(token), `the extractable block must not reference "${token}"`)
  }
  assert.ok(!/\bawait\b/.test(block), 'the extractable block must not contain await')
})

test('AC-2: scopeOf strips a trailing :line[:col], trims whitespace, and returns "" for anything that is not a bare file path', () => {
  const { scopeOf } = loadFixLoopDecisions()
  assert.equal(scopeOf('toy/src/app.js:42'), 'toy/src/app.js')
  assert.equal(scopeOf('toy/src/app.js:42:9'), 'toy/src/app.js')
  assert.equal(scopeOf('toy/src/app.js'), 'toy/src/app.js')
  assert.equal(scopeOf(' .claude/workflows/build-implement.js:300 '), '.claude/workflows/build-implement.js')
  assert.equal(scopeOf('GET /items'), '')
  assert.equal(scopeOf(''), '')
  assert.equal(scopeOf(undefined), '')
})

test('AC-3: scopeTargets collects distinct file locations from findings in first-seen order, dropping non-file locations', () => {
  const { scopeTargets } = loadFixLoopDecisions()
  const findings = [
    finding({ location: 'toy/src/app.js:10' }),
    finding({ location: 'toy/src/app.js:88' }),
    finding({ location: 'toy/README.md:3' }),
    finding({ location: 'GET /items' }),
    finding({ location: 'toy/src/app.js' }),
  ]
  assert.deepEqual(scopeTargets(findings), ['toy/src/app.js', 'toy/README.md'])
  assert.deepEqual(scopeTargets([]), [], 'a round with no code findings asks for no slices')
})

test('AC-4: nextLenses retries only the lens with a live finding, settling the lens whose findings were all overruled', () => {
  const { nextLenses } = loadFixLoopDecisions()
  const findings = [
    finding({ id: 'f1', lens: 'security', location: 'toy/src/app.js:1', dedupe_key: 's1' }),
    finding({ id: 'f2', lens: 'security', location: 'toy/src/app.js:2', dedupe_key: 's2' }),
    finding({ id: 'f3', lens: 'spec_conformance', location: 'toy/src/app.js:3', dedupe_key: 'p1' }),
  ]
  const resolution = { s1: 'fixed', s2: 'overruled', p1: 'overruled' }
  const result = nextLenses({ lenses: LENSES3, findings, resolution, mode: 'retry', verified: [] })
  assert.deepEqual(result.retry, ['security'])
  assert.deepEqual(result.settled, ['spec_conformance'])
  for (const l of result.retry) assert.ok(!result.settled.includes(l), 'a lens in retry must never also be in settled')
})

test('AC-5: a finding upheld on dispute, deferred past the fixer cap, or left unresolved all keep their lens in the re-panel set', () => {
  const { nextLenses } = loadFixLoopDecisions()
  for (const resolutionValue of ['upheld', 'deferred', 'unresolved']) {
    const findings = [finding({ id: 'f1', lens: 'correctness', location: 'toy/src/app.js:5', dedupe_key: 'c1' })]
    const result = nextLenses({ lenses: LENSES3, findings, resolution: { c1: resolutionValue }, mode: 'retry', verified: [] })
    assert.deepEqual(result, { retry: ['correctness'], settled: [] }, `resolution "${resolutionValue}" must keep correctness in retry`)
  }
})

test('AC-6: mode "all" retries every lens in order regardless of resolutions, and lensesToRun runs the whole panel', () => {
  const { nextLenses, lensesToRun } = loadFixLoopDecisions()
  const result = nextLenses({ lenses: LENSES3, findings: [finding()], resolution: { k0: 'fixed' }, mode: 'all', verified: [] })
  assert.deepEqual(result.retry, LENSES3)
  assert.deepEqual(result.settled, [])
  assert.deepEqual(lensesToRun({ lenses: LENSES3, retry: result.retry, verified: ['security'], mode: 'all' }), LENSES3)
})

test('AC-7: a round the adjudicator resolved as pass retries nothing, and lensesToRun signals the loop is done', () => {
  const { nextLenses, lensesToRun } = loadFixLoopDecisions()
  const next = nextLenses({ lenses: LENSES3, findings: [], resolution: {}, mode: 'retry', verified: [] })
  assert.deepEqual(next, { retry: [], settled: [] })
  const run = lensesToRun({ lenses: LENSES3, retry: [], verified: ['spec_conformance', 'security', 'correctness'], mode: 'retry' })
  assert.deepEqual(run, [], 'an empty list is the signal that every lens is verified')
})

test('AC-8: lensesToRun prefers outstanding retries, and otherwise confirms only lenses not yet verified', () => {
  const { lensesToRun } = loadFixLoopDecisions()
  assert.deepEqual(
    lensesToRun({ lenses: LENSES3, retry: ['security'], verified: ['spec_conformance'], mode: 'retry' }),
    ['security'],
  )
  assert.deepEqual(
    lensesToRun({ lenses: LENSES3, retry: [], verified: ['security', 'spec_conformance'], mode: 'retry' }),
    ['correctness'],
  )
})

test('AC-9: roundBudget defaults to floor(task_tokens / k_rounds), honors an explicit override, floors at 1, and degrades to the task ceiling when k_rounds is falsy', () => {
  const { roundBudget } = loadFixLoopDecisions()
  assert.equal(roundBudget({ task_tokens: 300000, k_rounds: 3 }), 100000)
  assert.equal(roundBudget({ task_tokens: 300000, k_rounds: 3, round_tokens: 50000 }), 50000)
  assert.equal(roundBudget({ task_tokens: 2, k_rounds: 5 }), 1)
  assert.equal(roundBudget({ task_tokens: 300000, k_rounds: 0 }), 300000)
})

test('AC-10: taskCeiling splits a WorkItem token budget evenly across its tasks, falling back to the default when absent or zero', () => {
  const { taskCeiling } = loadFixLoopDecisions()
  assert.equal(taskCeiling({ work_item_tokens: 1100000, tasks_for_work_item: 2, default_task_tokens: 250000 }), 550000)
  assert.equal(taskCeiling({ work_item_tokens: 0, tasks_for_work_item: 2, default_task_tokens: 250000 }), 250000)
  assert.equal(taskCeiling({ tasks_for_work_item: 1, default_task_tokens: 250000 }), 250000)
})

test('AC-11: shouldEscalate returns "budget" once cumulative task spend reaches the task ceiling, even with rounds left and a fresh finding', () => {
  const { shouldEscalate } = loadFixLoopDecisions()
  const ctx = { round: 1, k_rounds: 3, tokens: 560000, task_tokens: 550000, last_round_tokens: 10000, round_tokens: 183333, seen: new Set() }
  const findings = [finding({ dedupe_key: 'fresh-1' })]
  assert.equal(shouldEscalate(ctx, findings), 'budget')
})

test('AC-12: shouldEscalate returns "budget" when the round just finished overran its own per-round ceiling, else null when inside both ceilings', () => {
  const { shouldEscalate } = loadFixLoopDecisions()
  const findings = [finding({ dedupe_key: 'fresh-1' })]
  const overRound = { round: 1, k_rounds: 3, tokens: 200000, task_tokens: 550000, last_round_tokens: 250000, round_tokens: 183333, seen: new Set() }
  assert.equal(shouldEscalate(overRound, findings), 'budget')
  const withinRound = { ...overRound, last_round_tokens: 100000 }
  assert.equal(shouldEscalate(withinRound, findings), null)
})

test('AC-13: shouldEscalate checks budget before max_rounds, and still reports the existing repeat/no-fresh reasons with no new enum value', () => {
  const { shouldEscalate } = loadFixLoopDecisions()
  const VALID_REASONS = ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro']

  const overBudgetAtMaxRounds = { round: 3, k_rounds: 3, tokens: 600000, task_tokens: 550000, last_round_tokens: 10000, round_tokens: 183333, seen: new Set() }
  const r1 = shouldEscalate(overBudgetAtMaxRounds, [finding({ dedupe_key: 'fresh-1' })])
  assert.equal(r1, 'budget', 'budget must be checked before max_rounds so cost is the reported reason when cost is the cause')

  // At the cap with a finding that has ALREADY been through a fixer: max_rounds, as before. The grace round below
  // is scoped to findings that never reached one, so a retread still stops here.
  const atMaxRoundsRetread = { round: 3, k_rounds: 3, tokens: 10, task_tokens: 550000, last_round_tokens: 10, round_tokens: 183333, seen: new Set(['fresh-1']), lens_streaks: {} }
  const r2 = shouldEscalate(atMaxRoundsRetread, [finding({ dedupe_key: 'fresh-1' }), finding({ dedupe_key: 'other' })])
  assert.equal(r2, 'max_rounds')

  // Same cap, but grace already spent: max_rounds again. Grace is once per task, never a standing extension.
  const graceSpent = { round: 3, k_rounds: 3, tokens: 10, task_tokens: 550000, last_round_tokens: 10, round_tokens: 183333, seen: new Set(), lens_streaks: {}, grace_used: true }
  assert.equal(shouldEscalate(graceSpent, [finding({ dedupe_key: 'fresh-1' })]), 'max_rounds')

  const repeatCtx = { round: 2, k_rounds: 3, tokens: 10, task_tokens: 550000, last_round_tokens: 10, round_tokens: 183333, seen: new Set(['k1']) }
  const r3 = shouldEscalate(repeatCtx, [finding({ dedupe_key: 'k1' })])
  assert.equal(r3, 'repeat_finding')

  // Same context, now seen also contains k2 (in addition to k1), and this round's
  // only finding is k2 — everything already known, nothing fresh to act on.
  const staleCtx = { ...repeatCtx, seen: new Set(['k1', 'k2']) }
  const r4 = shouldEscalate(staleCtx, [finding({ dedupe_key: 'k2' })])
  assert.equal(r4, 'no_fresh_findings')

  for (const r of [r1, r2, r3, r4]) assert.ok(VALID_REASONS.includes(r), `"${r}" must be one of the existing Escalation reasons`)
})

// ---- Added by hand (direct_driver) after run t4i escalated on its own convergence defects. ----

test('the round cap grants exactly one grace round for findings that never reached a fixer, and never to a stuck lens', () => {
  const { shouldEscalate } = loadFixLoopDecisions()
  const base = { round: 3, k_rounds: 3, tokens: 10, task_tokens: 550000, last_round_tokens: 10, round_tokens: 183333 }

  // t4i's exact shape: at the cap, one finding raised for the first time this round, zero fix attempts on it.
  // Escalating here pays for a panel and throws its output away.
  const firstSighting = { ...base, seen: new Set(), lens_streaks: {}, grace_used: false }
  assert.equal(shouldEscalate(firstSighting, [finding({ dedupe_key: 'never-seen' })]), null,
    'a brand-new finding at the cap earns one fix pass rather than being discovered and discarded')

  // Mixed: one fresh, one already attempted. Not all-fresh, so no grace.
  const mixed = { ...base, seen: new Set(['old']), lens_streaks: {}, grace_used: false }
  assert.equal(shouldEscalate(mixed, [finding({ dedupe_key: 'old' }), finding({ dedupe_key: 'new' })]), 'max_rounds')

  // A lens already failing k_rounds straight is stuck, not unlucky: it reports repeat_finding and gets no grace.
  const stuck = { ...base, seen: new Set(), lens_streaks: { correctness: 3 }, grace_used: false }
  assert.equal(shouldEscalate(stuck, [finding({ dedupe_key: 'never-seen', lens: 'correctness' })]), 'repeat_finding')

  // No findings at all is not a grace case. At the cap that reads as max_rounds, because the round cap is checked
  // before the fresh-findings rule and always was; below the cap the same empty set reads as no_fresh_findings.
  assert.equal(shouldEscalate({ ...base, seen: new Set(), lens_streaks: {} }, []), 'max_rounds')
  assert.equal(shouldEscalate({ ...base, round: 2, seen: new Set(), lens_streaks: {} }, []), 'no_fresh_findings')
})

test('a lens that fails k_rounds consecutive rounds escalates even when every finding carries a fresh dedupe_key', () => {
  const text = readWorkflowText()
  const { block } = extractBlock(text)
  const { lensStreaks, stuckLens } = new Function(block + '\nreturn { lensStreaks, stuckLens }')()

  // The t4i chain: three rounds, correctness failing each time under a DIFFERENT key every round.
  let streaks = {}
  streaks = lensStreaks(streaks, ['spec_conformance', 'security', 'correctness'], [finding({ lens: 'correctness', dedupe_key: 'v1' })])
  assert.deepEqual(streaks, { spec_conformance: 0, security: 0, correctness: 1 })
  streaks = lensStreaks(streaks, ['correctness'], [finding({ lens: 'correctness', dedupe_key: 'v2' })])
  streaks = lensStreaks(streaks, ['correctness'], [finding({ lens: 'correctness', dedupe_key: 'v3' })])
  assert.equal(streaks.correctness, 3, 'three consecutive failures counted, though no key ever repeated')
  assert.equal(stuckLens(streaks, 3), 'correctness')

  // A passing round clears the streak — only consecutive failures count.
  const cleared = lensStreaks(streaks, ['correctness'], [])
  assert.equal(cleared.correctness, 0)
  assert.equal(stuckLens(cleared, 3), null)

  // A lens that sat the round out keeps its streak rather than being reset by absence.
  const satOut = lensStreaks({ correctness: 2 }, ['security'], [])
  assert.equal(satOut.correctness, 2)
})

test('runTask builds a spec summary without referencing its own binding when no spec_ref is passed', () => {
  const text = readWorkflowText()
  const initializer = text.slice(text.indexOf('const specText = spec_ref'), text.indexOf('const depIds'))
  assert.ok(initializer.includes('spec_ref'), 'expected to find the specText initializer')
  assert.ok(!/:\s*`\$\{specText\}`/.test(initializer),
    'the else branch must not read specText inside its own initializer — that is a temporal dead zone ReferenceError that crashed every task on any call without spec_ref')
  assert.match(initializer, /acceptance/, 'with no ref to point at, the spec is inlined whole including its acceptance criteria')
})

// ---- Added by hand (direct_driver): the empty-diff deadlock from run t5i. ----

test('emptyDiffAction never lets a panel run on a diff that measured empty', () => {
  const text = readWorkflowText()
  const { block } = extractBlock(text)
  const { emptyDiffAction } = new Function(block + '\nreturn { emptyDiffAction }')()

  // There is something to review.
  assert.equal(emptyDiffAction({ diff_bytes: 42, touched_surfaces_count: 1, has_deps: true, recaptured: false }), 'proceed')

  // Legacy ChangeSet: no bytes reported, but surfaces declared. Proceed — no new agent call on the old path.
  assert.equal(emptyDiffAction({ diff_bytes: null, touched_surfaces_count: 2, has_deps: false, recaptured: false }), 'proceed')
  assert.equal(emptyDiffAction({ diff_bytes: undefined, touched_surfaces_count: 1, has_deps: false, recaptured: false }), 'proceed')

  // Nothing reported and nothing declared: ask once rather than assume either way.
  assert.equal(emptyDiffAction({ diff_bytes: null, touched_surfaces_count: 0, has_deps: false, recaptured: false }), 'measure')

  // The t5i shape: empty, but a dependency could legitimately already carry the work. Re-diff against the run base.
  assert.equal(emptyDiffAction({ diff_bytes: 0, touched_surfaces_count: 0, has_deps: true, recaptured: false }), 'recapture')

  // Still empty after the re-capture, or empty with no dependency to explain it: refuse. Never a second re-capture.
  assert.equal(emptyDiffAction({ diff_bytes: 0, touched_surfaces_count: 0, has_deps: true, recaptured: true }), 'refuse')
  assert.equal(emptyDiffAction({ diff_bytes: 0, touched_surfaces_count: 0, has_deps: false, recaptured: false }), 'refuse')

  // An empty diff is refused even when surfaces were declared — the declaration is not the change.
  assert.equal(emptyDiffAction({ diff_bytes: 0, touched_surfaces_count: 5, has_deps: false, recaptured: false }), 'refuse')
})

test('the empty-diff gate sits before any lens, test runner or fixer call', () => {
  const text = readWorkflowText()
  const gate = text.indexOf('Empty-diff gate')
  assert.ok(gate > 0, 'the gate must exist')

  // It must be reached before the panel: the first lens( call in runTask comes after it.
  const firstLens = text.indexOf('lens(', gate)
  const firstRun = text.indexOf('run:${task.id}', gate)
  assert.ok(firstLens > gate, 'no lens may be called before the emptiness decision')
  assert.ok(firstRun > gate, 'the test runner may not be called before the emptiness decision')

  // A refusal must escalate honestly with the contract's existing reason, never invent one.
  const section = text.slice(gate, text.indexOf('let changeSet1'))
  assert.match(section, /cannot_repro/, 'a refused task escalates with the existing cannot_repro reason')
  assert.ok(!/max_rounds|repeat_finding/.test(section), 'an empty diff is not a round-count or repeat failure')
  assert.match(section, /owned surfaces/, 'the refusal must point at the likely cause: a dependency that wrote outside its owned surfaces')
})
