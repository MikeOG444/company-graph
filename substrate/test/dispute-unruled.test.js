// Tests for spec-wi-a7-test-dispute-unruled: closing the pass-by-default hole in the
// verify->fix loop of ./.claude/workflows/build-implement.js measured on run k1v.
//
// Written from the spec (spec-wi-a7-test-dispute-unruled) ONLY: every scenario below is
// transcribed from the acceptance criteria's own given/when/then, not from reading the
// implementation. Covers AC-1 through AC-16. AC-17 is CHANGE-SCOPED (diff-shape, not a
// landed-test property) and is deliberately not represented here — it is verified by the
// verifier panel reading the diff, not by any test that can run on a future commit.
//
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). Uses the extract-fixloop.js sentinel idiom
// (readWorkflowText/extractBlock + new Function) to drive the five new pure decision
// functions directly, and the source-text wiring style of fix-loop-wiring.test.js and
// boundary-wiring.test.js for the AC-12..AC-15 call-site checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'
import { readWorkflowText, extractBlock, loadFixLoopDecisions } from './extract-fixloop.js'

// ---------------------------------------------------------------------------
// Fixtures — minimal, contract-shaped Finding objects (see contracts.schema.json
// #/$defs/Finding), built the same way boundary-decision-functions.test.js does.
// ---------------------------------------------------------------------------
function finding(overrides) {
  return {
    id: 'f0', lens: 'correctness', severity: 'medium',
    location: 'toy/src/app.js:1', claim: 'claim', evidence: 'evidence',
    dedupe_key: 'k0', target: 'implementation', status: 'open',
    ...overrides,
  }
}

// Loads the five NEW fix-loop decision functions directly from the sentinel block, per
// AC-1's own given/when/then: read with readWorkflowText()/extractBlock(), then evaluated
// as `new Function(block + 'return { ... }')()`. Deliberately independent of
// loadFixLoopDecisions() (which this work item must not have to touch) so that AC-1's own
// claim — that loadFixLoopDecisions() still returns exactly its seventeen existing
// functions — is checked, not assumed.
function loadNewFixLoopDecisions() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return { disputesToJudge, resolveRound, roundOutcome, testRepairTarget, unlandedRepairs }`)
  return factory()
}

// Finds the first top-level call to `callName(` at or after `fromIdx` and returns the
// balanced-paren argument text plus the index range of the whole call, so wiring checks
// can inspect a call site's arguments without guessing exact formatting.
function extractCall(text, callName, fromIdx = 0) {
  const openIdx = text.indexOf(callName + '(', fromIdx)
  if (openIdx === -1) return null
  const parenStart = openIdx + callName.length
  let depth = 0
  let i = parenStart
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return { start: openIdx, end: i, args: text.slice(parenStart + 1, i - 1) }
}

// ---------------------------------------------------------------------------
// AC-1
// ---------------------------------------------------------------------------
test('AC-1: the sentinel block evaluates and exposes the five new decision functions; the seventeen existing ones are untouched; forbidden tokens absent', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1, 'BEGIN sentinel line must appear exactly once')
  assert.equal(endCount, 1, 'END sentinel line must appear exactly once')
  assert.ok(block && block.trim().length > 0, 'expected a non-empty block between the sentinels')

  const decisions = loadNewFixLoopDecisions()
  for (const name of ['disputesToJudge', 'resolveRound', 'roundOutcome', 'testRepairTarget', 'unlandedRepairs']) {
    assert.equal(typeof decisions[name], 'function', `${name} must be a function`)
  }

  const existing = loadFixLoopDecisions()
  const EXISTING_SEVENTEEN = [
    'scopeOf', 'scopeTargets', 'nextLenses', 'lensesToRun', 'roundBudget', 'taskCeiling', 'emptyDiffAction',
    'shouldEscalate', 'surfaceRef', 'withinOwned', 'boundaryCheck', 'criteriaScope', 'citedCriteria',
    'isForeignCriterionFinding', 'stripForeignFindings', 'routeFinding', 'fixOutcome',
  ]
  assert.deepEqual(Object.keys(existing).sort(), EXISTING_SEVENTEEN.sort())
  for (const name of EXISTING_SEVENTEEN) assert.equal(typeof existing[name], 'function', `${name} must still be a function`)

  for (const token of ['args', 'agent(', 'parallel(', 'pipeline(', 'phase(', 'log(', 'budget.']) {
    assert.ok(!block.includes(token), `the block must not contain "${token}"`)
  }
  assert.ok(!/\bawait\b/.test(block), 'the block must not contain await')
})

// ---------------------------------------------------------------------------
// AC-2: disputesToJudge
// ---------------------------------------------------------------------------
test('AC-2: disputesToJudge selects one entry per disputing dedupe_key, first occurrence, independent of repair path', () => {
  const { disputesToJudge } = loadNewFixLoopDecisions()
  const repairs = [
    { dedupe_key: 'k1', path: 'code', notes: 'DISPUTE: a' },
    { dedupe_key: 'k2', path: 'test', notes: 'DISPUTE: b' },
    { dedupe_key: 'k3', path: 'test', notes: 'repaired the assertion' },
    { dedupe_key: 'k4', path: 'code', notes: 'TEST-ONLY: c' },
    { dedupe_key: 'k2', path: 'test', notes: 'DISPUTE: b restated' },
  ]
  const keysOf = (result) => result.map(x => (typeof x === 'string' ? x : x.dedupe_key))

  const first = keysOf(disputesToJudge(repairs))
  assert.deepEqual(first, ['k1', 'k2'])

  const flipped = repairs.map(r => ({ ...r, path: r.path === 'code' ? 'test' : 'code' }))
  const second = keysOf(disputesToJudge(flipped))
  assert.deepEqual(second, ['k1', 'k2'], 'the judge input must not depend on which repair path produced the dispute')
})

// ---------------------------------------------------------------------------
// AC-3..AC-9: resolveRound
// ---------------------------------------------------------------------------
test('AC-3: resolveRound sets a resolution entry for every dedupe_key given it, and carries every unresolved/deferred/upheld finding forward', () => {
  const { resolveRound } = loadNewFixLoopDecisions()
  const f0 = finding({ id: 'f0', dedupe_key: 'k0' })
  const f1 = finding({ id: 'f1', dedupe_key: 'k1' })
  const f2 = finding({ id: 'f2', dedupe_key: 'k2' })
  const f3 = finding({ id: 'f3', dedupe_key: 'k3' })

  const result = resolveRound({
    findings: [f1, f2],
    carried_in: [f0],
    deferred: [f3],
    repairs: [{ dedupe_key: 'k1', path: 'code', notes: undefined }],
    rulings: [],
    tests_ref: '.artifacts/tests/t1/',
  })

  assert.deepEqual(Object.keys(result.resolution).sort(), ['k0', 'k1', 'k2', 'k3'])
  assert.equal(result.resolution.k1, 'fixed')
  assert.equal(result.resolution.k3, 'deferred')
  assert.equal(result.resolution.k0, 'unresolved')
  assert.equal(result.resolution.k2, 'unresolved')

  const carriedKeys = result.carried.map(f => f.dedupe_key).sort()
  assert.deepEqual(carriedKeys, ['k0', 'k2', 'k3'])
})

test('AC-4: a Test Author dispute that is upheld resolves and carries identically to a code Fixer dispute that is upheld', () => {
  const { resolveRound } = loadNewFixLoopDecisions()
  const f = finding({
    id: 'f1', dedupe_key: 'k1', severity: 'high', target: 'test',
    location: 'substrate/test/ci-workflow.test.js:190',
  })
  const base = {
    findings: [f], carried_in: [], deferred: [], rulings: [{ dedupe_key: 'k1', ruling: 'uphold' }],
    tests_ref: '.artifacts/tests/t1/',
  }
  const testRepair = [{ dedupe_key: 'k1', path: 'test', target_source: 'tests_ref', notes: 'DISPUTE: the finding is real but does not apply to the file I am responsible for' }]
  const codeRepair = [{ dedupe_key: 'k1', path: 'code', target_source: 'tests_ref', notes: testRepair[0].notes }]

  const testResult = resolveRound({ ...base, repairs: testRepair })
  const codeResult = resolveRound({ ...base, repairs: codeRepair })

  assert.equal(testResult.resolution.k1, 'upheld')
  assert.ok(testResult.carried.some(c => c.dedupe_key === 'k1'))
  assert.deepEqual(testResult.resolution, codeResult.resolution)
  assert.deepEqual(testResult.carried.map(c => c.dedupe_key), codeResult.carried.map(c => c.dedupe_key))
})

test('AC-5: a Test Author dispute that is overruled resolves and carries identically to a code Fixer dispute that is overruled', () => {
  const { resolveRound } = loadNewFixLoopDecisions()
  const f = finding({
    id: 'f1', dedupe_key: 'k1', severity: 'high', target: 'test',
    location: 'substrate/test/ci-workflow.test.js:190',
  })
  const base = {
    findings: [f], carried_in: [], deferred: [], rulings: [{ dedupe_key: 'k1', ruling: 'overrule' }],
    tests_ref: '.artifacts/tests/t1/',
  }
  const testRepair = [{ dedupe_key: 'k1', path: 'test', target_source: 'tests_ref', notes: 'DISPUTE: the finding is real but does not apply to the file I am responsible for' }]
  const codeRepair = [{ dedupe_key: 'k1', path: 'code', target_source: 'tests_ref', notes: testRepair[0].notes }]

  const testResult = resolveRound({ ...base, repairs: testRepair })
  const codeResult = resolveRound({ ...base, repairs: codeRepair })

  assert.equal(testResult.resolution.k1, 'overruled')
  assert.deepEqual(testResult.carried, [])
  assert.deepEqual(testResult.resolution, codeResult.resolution)
  assert.deepEqual(testResult.carried, codeResult.carried)
})

test('AC-6: the k1v regression — an unruled test-repair dispute is never absent from resolution, is carried, and forces roundOutcome to escalate rather than pass', () => {
  const { resolveRound, roundOutcome } = loadNewFixLoopDecisions()
  const f = finding({
    id: 'f1', dedupe_key: 'k1', severity: 'high', target: 'test',
    location: 'substrate/test/ci-workflow.test.js:190',
  })
  const result = resolveRound({
    findings: [f],
    carried_in: [],
    deferred: [],
    repairs: [{ dedupe_key: 'k1', path: 'test', target_source: 'tests_ref', notes: 'DISPUTE: line 190 is correct as written' }],
    rulings: [],
    tests_ref: '.artifacts/tests/t1/',
  })

  assert.ok('k1' in result.resolution, 'k1 must never be absent from the round resolution')
  assert.equal(result.resolution.k1, 'unresolved')
  assert.ok(result.carried.some(c => c.dedupe_key === 'k1'))

  const outcome = roundOutcome({ panel_result: 'pass', carried: result.carried })
  assert.equal(outcome, 'escalate', 'a green panel must not pass when an unruled dispute is carried forward')
})

test('AC-7: roundOutcome returns pass only when nothing is carried, escalate for a green panel with a carry, and continue for a failing panel either way', () => {
  const { roundOutcome } = loadNewFixLoopDecisions()
  const f = finding({ id: 'f1', dedupe_key: 'k1' })
  assert.equal(roundOutcome({ panel_result: 'pass', carried: [] }), 'pass')
  assert.equal(roundOutcome({ panel_result: 'pass', carried: [f] }), 'escalate')
  assert.equal(roundOutcome({ panel_result: 'fail', carried: [] }), 'continue')
  assert.equal(roundOutcome({ panel_result: 'fail', carried: [f] }), 'continue')
})

test('AC-8: resolveRound.tests_ref tracks the last non-disputing repair that targeted the artifact TestSet, and is otherwise unchanged', () => {
  const { resolveRound } = loadNewFixLoopDecisions()
  const inputTestsRef = '.artifacts/tests/t1/'
  const base = { findings: [], carried_in: [], deferred: [], rulings: [], tests_ref: inputTestsRef }

  const repairs = [
    { dedupe_key: 'k1', path: 'test', target_source: 'tests_ref', tests_ref: '.artifacts/tests/t1/', notes: undefined },
    { dedupe_key: 'k2', path: 'test', target_source: 'tests_ref', tests_ref: '.artifacts/tests/t1-r2/', notes: undefined },
    { dedupe_key: 'k3', path: 'test', target_source: 'tests_ref', tests_ref: '.artifacts/tests/ignored/', notes: 'DISPUTE: no' },
    { dedupe_key: 'k4', path: 'test', target_source: 'finding_location', tests_ref: '.artifacts/worktrees/task-t1/substrate/test/ci-workflow.test.js', notes: undefined },
  ]

  assert.equal(resolveRound({ ...base, repairs }).tests_ref, '.artifacts/tests/t1-r2/')
  assert.equal(resolveRound({ ...base, repairs: [] }).tests_ref, inputTestsRef)
  assert.equal(resolveRound({ ...base, repairs: [repairs[2], repairs[3]] }).tests_ref, inputTestsRef)
})

test('AC-9: resolveRound.needs_rediff is true for a code fix or a task-branch test edit, and false for an artifact-TestSet edit, a dispute, or no repairs', () => {
  const { resolveRound } = loadNewFixLoopDecisions()
  const base = { findings: [], carried_in: [], deferred: [], rulings: [], tests_ref: '.artifacts/tests/t1/' }

  const A = [{ dedupe_key: 'k1', path: 'code', notes: undefined }]
  const B = [{ dedupe_key: 'k1', path: 'test', target_source: 'finding_location', notes: undefined }]
  const C = [{ dedupe_key: 'k1', path: 'test', target_source: 'tests_ref', notes: undefined }]
  const D = [{ dedupe_key: 'k1', path: 'test', target_source: 'finding_location', notes: 'DISPUTE: no' }]
  const E = []

  assert.equal(resolveRound({ ...base, repairs: A }).needs_rediff, true, 'A: code fix')
  assert.equal(resolveRound({ ...base, repairs: B }).needs_rediff, true, 'B: task-branch test edit')
  assert.equal(resolveRound({ ...base, repairs: C }).needs_rediff, false, 'C: artifact TestSet edit')
  assert.equal(resolveRound({ ...base, repairs: D }).needs_rediff, false, 'D: dispute')
  assert.equal(resolveRound({ ...base, repairs: E }).needs_rediff, false, 'E: no repairs')
})

// ---------------------------------------------------------------------------
// AC-10: testRepairTarget
// ---------------------------------------------------------------------------
test('AC-10: testRepairTarget points at the file a finding cites inside the worktree, falls back to tests_ref, and strips ":line[:col]"', () => {
  const { testRepairTarget } = loadNewFixLoopDecisions()
  const artifact_dir = '.artifacts'
  const tests_ref = '.artifacts/tests/t1/'
  const worktree = '.artifacts/worktrees/task-t1'

  const a = testRepairTarget({ finding: finding({ location: 'substrate/test/ci-workflow.test.js:190' }), tests_ref, artifact_dir, worktree })
  assert.deepEqual(a, { ref: '.artifacts/worktrees/task-t1/substrate/test/ci-workflow.test.js', source: 'finding_location' })

  const b = testRepairTarget({ finding: finding({ location: '.artifacts/tests/t1/ac9.test.js:12' }), tests_ref, artifact_dir, worktree })
  assert.deepEqual(b, { ref: '.artifacts/tests/t1/ac9.test.js', source: 'tests_ref' })

  const c = testRepairTarget({ finding: finding({ location: 'the AC-9 assertion' }), tests_ref, artifact_dir, worktree })
  assert.deepEqual(c, { ref: tests_ref, source: 'tests_ref' })

  const aNoWorktree = testRepairTarget({ finding: finding({ location: 'substrate/test/ci-workflow.test.js:190' }), tests_ref, artifact_dir })
  assert.deepEqual(aNoWorktree, { ref: 'substrate/test/ci-workflow.test.js', source: 'finding_location' })
})

// ---------------------------------------------------------------------------
// AC-11: unlandedRepairs
// ---------------------------------------------------------------------------
test('AC-11: unlandedRepairs names a skipped basename the repair path edited in the artifact TestSet, excludes a branch-carried repair and an untouched file, and degrades to empty', () => {
  const { unlandedRepairs } = loadNewFixLoopDecisions()
  const repaired_tests = [
    { ref: '.artifacts/tests/t1/ci-workflow.test.js', source: 'tests_ref' },
    { ref: '.artifacts/worktrees/task-t1/substrate/test/branch-only.test.js', source: 'finding_location' },
  ]

  const result = unlandedRepairs({ tests_skipped: ['ci-workflow.test.js', 'branch-only.test.js', 'helpers.js'], repaired_tests })
  assert.deepEqual(result, ['ci-workflow.test.js'])

  assert.deepEqual(unlandedRepairs({ tests_skipped: [], repaired_tests }), [])
  assert.deepEqual(unlandedRepairs({ tests_skipped: ['ci-workflow.test.js', 'branch-only.test.js', 'helpers.js'], repaired_tests: [] }), [])
})

// ---------------------------------------------------------------------------
// AC-12..AC-15: source-text wiring
// ---------------------------------------------------------------------------
test('AC-12: the code-only dispute filter is gone; disputesToJudge drives the judge fan-out and the ctx.upheld/ctx.overruled loop', () => {
  const text = readWorkflowText()

  const disputeLineMatches = text.split('\n').filter(line => line.includes("=== 'dispute'"))
  assert.ok(disputeLineMatches.length > 0, 'expected at least one line classifying a dispute outcome')
  for (const line of disputeLineMatches) {
    assert.ok(!line.includes("kind === 'code'"), `the pre-fix code-only dispute filter must be gone: "${line.trim()}"`)
  }

  const call = extractCall(text, 'disputesToJudge')
  assert.ok(call, 'expected at least one call to disputesToJudge(')

  assert.ok(text.includes('ctx.upheld'), 'the judge loop must still push to ctx.upheld')
  assert.ok(text.includes('ctx.overruled'), 'the judge loop must still push to ctx.overruled')
})

test('AC-13: resolveRound feeds nextLenses\' resolution argument, roundOutcome is called, and the single "passed: true" is guarded by it', () => {
  const text = readWorkflowText()

  // resolveRound is one of the five decision functions DEFINED inside the sentinel block
  // (`function resolveRound({...}) {`), so a naive first-occurrence-of-"resolveRound("
  // search finds that definition, not a call site: the text right before it is
  // "function ", which is not an assignment, so it can never carry a "resolution"
  // binding forward to nextLenses. The definition itself never proves the wiring the
  // spec cares about, so every call site must be found and the definition excluded.
  function isFunctionDefinitionAt(t, callStart) {
    return /function\s+$/.test(t.slice(Math.max(0, callStart - 20), callStart))
  }
  function allCallSites(t, callName) {
    const sites = []
    let fromIdx = 0
    for (;;) {
      const c = extractCall(t, callName, fromIdx)
      if (!c) break
      if (!isFunctionDefinitionAt(t, c.start)) sites.push(c)
      fromIdx = c.start + callName.length + 1
    }
    return sites
  }

  const resolveRoundCalls = allCallSites(text, 'resolveRound')
  assert.ok(resolveRoundCalls.length > 0, 'expected at least one call to resolveRound( (excluding its own definition)')

  // The spec (AC-13) only requires that SOME call to resolveRound's returned resolution be
  // the value passed as nextLenses' resolution argument — it does not prescribe how many
  // call sites exist, or how each one binds resolveRound's result. Two idioms satisfy the
  // binding: destructuring `resolution` straight out of the call, or binding the whole
  // result to a name and later reading `<name>.resolution`. Detect either, per call site.
  function resolutionTokenFor(t, callStart) {
    const beforeCall = t.slice(0, callStart)
    const destructureMatch = beforeCall.match(/(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?$/)
    if (destructureMatch) {
      const resolutionBinding = destructureMatch[1].split(',').map(s => s.trim()).find(s => s.startsWith('resolution'))
      if (!resolutionBinding) return null
      return resolutionBinding.includes(':') ? resolutionBinding.split(':')[1].trim() : 'resolution'
    }
    const assignMatch = beforeCall.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?$/)
    if (assignMatch) return `${assignMatch[1]}.resolution`
    return null
  }

  const nextLensesCalls = [...text.matchAll(/nextLenses\(/g)].map(m => m.index)
  assert.ok(nextLensesCalls.length > 0, 'expected at least one call to nextLenses(')

  const feedsResolution = resolveRoundCalls.some(call => {
    const resolutionToken = resolutionTokenFor(text, call.start)
    if (!resolutionToken) return false
    const escapedToken = resolutionToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return nextLensesCalls.some(idx => {
      const c = extractCall(text, 'nextLenses', idx)
      return c && new RegExp(`\\b${escapedToken}\\b`).test(c.args)
    })
  })
  assert.ok(feedsResolution, 'at least one resolveRound( call\'s resolution must be passed into a nextLenses( call')

  const roundOutcomeCall = extractCall(text, 'roundOutcome')
  assert.ok(roundOutcomeCall, 'expected a call to roundOutcome(')

  const passedTrueMatches = [...text.matchAll(/passed:\s*true/g)]
  assert.equal(passedTrueMatches.length, 1, 'the literal "passed: true" must occur exactly once')
  const idx = passedTrueMatches[0].index
  const preceding = text.slice(Math.max(0, idx - 500), idx)
  assert.ok(preceding.includes('roundOutcome('), 'the only route to a passing task must run through the roundOutcome guard')
})

test('AC-14: both testfix: prompts point at testRepairTarget\'s ref, the fixed tests_ref wording is gone, and independence is preserved', () => {
  const text = readWorkflowText()

  const testfixLabels = [...text.matchAll(/label:\s*`testfix:/g)]
  assert.equal(testfixLabels.length, 2, 'expected exactly two testfix: agent call sites')

  const targetAssign = text.match(/(\w+)\s*=\s*testRepairTarget\(/)
  assert.ok(targetAssign, 'expected an assignment of the form "<name> = testRepairTarget("')
  const varName = targetAssign[1]

  assert.doesNotMatch(text, /Repair the test under \$\{ctx\.testSet\.tests_ref\}/,
    'the fixed .artifacts tests_ref wording must no longer be the testfix prompt\'s target')

  for (const label of testfixLabels) {
    // Window the whole enclosing agent(...) call rather than slicing forward from the
    // label: object-literal key order isn't prescribed by the spec, and `prompt` may
    // appear before `label` in the call, putting the interpolation and the
    // "do not read or modify" text *before* the label rather than after it.
    const agentIdx = text.lastIndexOf('agent(', label.index)
    assert.ok(agentIdx !== -1, 'expected a preceding agent( call for this testfix label')
    const call = extractCall(text, 'agent', agentIdx)
    assert.ok(call, 'expected to extract the full agent(...) call for this testfix label')
    const window = text.slice(call.start, call.end)
    assert.ok(window.includes(`\${${varName}.ref}`), `each testfix prompt must interpolate \${${varName}.ref}`)
    assert.match(window, /do not read or modify the implementation/,
      'each testfix prompt must still tell the Test Author not to read or modify the implementation')
  }
})

test('AC-15: unlandedRepairs forces the integrate:resolve pass and names the skipped files in its prompt', () => {
  const text = readWorkflowText()

  // unlandedRepairs is one of the five decision functions DEFINED inside the sentinel block
  // (`function unlandedRepairs({...}) {`), so the FIRST occurrence of "unlandedRepairs(" in the
  // file is that definition, not the call site the guard and prompt actually reference — the
  // same trap AC-13's own isFunctionDefinitionAt()/allCallSites() above already guards against
  // for resolveRound. Anchoring the window on the definition's end (as a naive
  // extractCall(text, 'unlandedRepairs') would) pulls in the unrelated body of every decision
  // function that happens to sit between the definition and the integrate:resolve call, which
  // can make an assertion pass (or fail) for reasons that have nothing to do with the guard or
  // the prompt. Skip the definition explicitly and use the real call site instead.
  function isFunctionDefinitionAt(t, callStart) {
    return /function\s+$/.test(t.slice(Math.max(0, callStart - 20), callStart))
  }
  let callIdx = 0
  let call = extractCall(text, 'unlandedRepairs', callIdx)
  while (call && isFunctionDefinitionAt(text, call.start)) {
    callIdx = call.start + 'unlandedRepairs'.length + 1
    call = extractCall(text, 'unlandedRepairs', callIdx)
  }
  assert.ok(call, 'expected a call to unlandedRepairs( (excluding its own definition)')

  const assign = text.match(/(\w+)\s*=\s*unlandedRepairs\(/)
  assert.ok(assign, 'expected an assignment of the form "<name> = unlandedRepairs("')
  const varName = assign[1]
  const varPattern = new RegExp(`\\b${varName}\\b`)

  const resolveLabelIdx = text.indexOf('integrate:resolve')
  assert.ok(resolveLabelIdx >= 0, 'expected an integrate:resolve agent label')

  const agentOpenIdx = text.lastIndexOf('agent(', resolveLabelIdx)
  assert.ok(agentOpenIdx >= 0, 'expected an agent( call site wrapping the integrate:resolve label')
  const agentCall = extractCall(text, 'agent', agentOpenIdx)
  assert.ok(agentCall, 'expected a balanced agent( ... ) call for integrate:resolve')

  // The condition guarding that agent( call is whatever `if (...)` most closely precedes it —
  // found by walking back from the agent( call's own start and scanning its balanced parens,
  // not by guessing a fixed distance or window. This makes the assertion robust to however much
  // prompt text sits between the guard and the call, in either direction, without risking pulling
  // in code from unrelated functions the way anchoring on unlandedRepairs' definition did.
  const ifIdx = text.lastIndexOf('if (', agentOpenIdx)
  assert.ok(ifIdx >= 0, 'expected an if (...) guard preceding the integrate:resolve agent( call')
  const ifParenStart = ifIdx + 'if'.length
  let depth = 0
  let i = ifParenStart
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  const condition = text.slice(ifParenStart + 1, i - 1)

  assert.ok(varPattern.test(condition),
    `expected "${varName}" (unlandedRepairs' result) to appear in the condition guarding integrate:resolve`)
  assert.ok(varPattern.test(agentCall.args),
    `expected "${varName}" (unlandedRepairs' result) to be interpolated into the integrate:resolve prompt`)
})

// ---------------------------------------------------------------------------
// AC-16: contract and package.json shape
// ---------------------------------------------------------------------------
test('AC-16: contracts.schema.json Escalation/Finding shapes and package.json dependencies/test script are unchanged by this work', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'contracts.schema.json'), 'utf8'))
  assert.deepEqual(schema.$defs.Escalation.properties.reason.enum, ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro'])
  assert.ok(!(schema.$defs.Finding.required ?? []).includes('target'), 'Finding.target must remain optional')
  assert.deepEqual(schema.$defs.Finding.properties.target.enum, ['implementation', 'test'])

  const workflowText = readWorkflowText()
  const enumMatch = workflowText.match(/\[\s*'max_rounds'[^\]]*\]/)
  if (enumMatch) {
    const values = enumMatch[0].match(/'([^']+)'/g).map(s => s.slice(1, -1))
    const allowed = new Set(['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro'])
    for (const v of values) assert.ok(allowed.has(v), `inlined Escalation reason enum must not contain "${v}"`)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['ajv', 'ajv-formats'])
  assert.equal(pkg.scripts.test, 'node --test substrate/test/*.test.js')
})
