// Tests for spec-wi-b5-sibling-value-repair: the two new pure fix-loop decision functions,
// boundaryRepair and unaccountedTestFiles, added to the sentinel block of
// .claude/workflows/build-implement.js. Covers AC-1 through AC-7 and AC-21.
//
// Written from the spec (ledger/runs/k8/spec-wi-b5-sibling-value-repair.json) ONLY: every
// scenario below is transcribed from the acceptance criteria's own given/when/then, not from
// reading the implementation. Follows the same new Function loader idiom as
// substrate/test/dispute-unruled.test.js's loadNewFixLoopDecisions() (deliberately independent
// of substrate/test/extract-fixloop.js's own loadFixLoopDecisions(), which this work item does
// not touch), so that AC-1's own claim -- that the block still exposes every function it
// exposed before, unchanged -- is checked, not assumed.
//
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). Repository paths are resolved only through the
// existing extract-fixloop.js sentinel extractor (readWorkflowText/extractBlock), never by
// counting ".." from this file's own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock, loadFixLoopDecisions } from './extract-fixloop.js'

// The full set of decision-function names the sentinel block is expected to expose after this
// work: the seventeen originally named plus the five added by spec-wi-a7-test-dispute-unruled,
// plus the two this spec adds.
const PRE_EXISTING = [
  'scopeOf', 'scopeTargets', 'nextLenses', 'lensesToRun', 'roundBudget', 'taskCeiling', 'emptyDiffAction',
  'shouldEscalate', 'surfaceRef', 'withinOwned', 'boundaryCheck', 'criteriaScope', 'citedCriteria',
  'isForeignCriterionFinding', 'stripForeignFindings', 'routeFinding', 'fixOutcome',
  'disputesToJudge', 'resolveRound', 'roundOutcome', 'testRepairTarget', 'unlandedRepairs',
]
const NEW = ['boundaryRepair', 'unaccountedTestFiles']

// Loads the sentinel block and returns every function named in PRE_EXISTING plus NEW, exactly
// the way AC-1 describes (readWorkflowText()/extractBlock(), then
// `new Function(block + 'return {...}')()`).
function loadB5Decisions() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return {
      scopeOf, scopeTargets, nextLenses, lensesToRun, roundBudget, taskCeiling, emptyDiffAction, shouldEscalate,
      surfaceRef, withinOwned, boundaryCheck, criteriaScope, citedCriteria, isForeignCriterionFinding,
      stripForeignFindings, routeFinding, fixOutcome, disputesToJudge, resolveRound, roundOutcome,
      testRepairTarget, unlandedRepairs, boundaryRepair, unaccountedTestFiles,
    }`)
  return factory()
}

// Extracts the balanced-brace body of `function <name>(` ... `}` from the sentinel block text,
// including the signature, so a token search can be scoped to just that function rather than the
// whole block (which legitimately contains "agent", "log" etc. in comments describing OTHER,
// pre-existing functions).
function extractFunctionSource(block, name) {
  const sigIdx = block.indexOf(`function ${name}(`)
  if (sigIdx === -1) return null
  const braceIdx = block.indexOf('{', sigIdx)
  if (braceIdx === -1) return null
  let depth = 0
  let i = braceIdx
  for (; i < block.length; i++) {
    if (block[i] === '{') depth++
    else if (block[i] === '}') {
      depth--
      if (depth === 0) { i++; break }
    }
  }
  return block.slice(sigIdx, i)
}

test('AC-1: the sentinel block evaluates without throwing and exposes boundaryRepair and unaccountedTestFiles alongside every pre-existing decision function', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1, 'BEGIN sentinel line must appear exactly once')
  assert.equal(endCount, 1, 'END sentinel line must appear exactly once')
  assert.ok(block && block.trim().length > 0, 'expected a non-empty block between the sentinels')

  const decisions = loadB5Decisions()
  for (const name of [...PRE_EXISTING, ...NEW]) {
    assert.equal(typeof decisions[name], 'function', `${name} must be a function`)
  }

  // The pre-existing seventeen, as loaded by the untouched extract-fixloop.js loader, are exactly
  // unchanged in name and kind.
  const existing = loadFixLoopDecisions()
  for (const name of PRE_EXISTING) {
    if (name in existing) assert.equal(typeof existing[name], 'function', `${name} must still be a function via loadFixLoopDecisions()`)
  }

  for (const name of NEW) {
    const src = extractFunctionSource(block, name)
    assert.ok(src, `expected a function ${name}(...) definition in the sentinel block`)
    for (const token of ['agent', 'log', 'args', 'A.', 'phase', 'parallel', 'pipeline', 'budget', 'Date.now', 'Math.random', 'require', 'import', 'fs']) {
      assert.ok(!src.includes(token), `${name}'s body must not refer to "${token}"`)
    }
    assert.ok(!/child_process|execSync|spawnSync|spawn\(|exec\(/.test(src), `${name}'s body must not shell out`)
  }
})

test('AC-2: boundaryRepair returns "wait" with deduplicated, first-seen-order owners before an owner has finished', () => {
  const { boundaryRepair } = loadB5Decisions()

  const result = boundaryRepair({
    task_id: 't2',
    strays: [{ ref: '.claude/agents/x.md', owner: 't1' }],
    needs_from_sibling: [],
    siblings: [{ id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/' }] }],
    repair_used: false,
    violations: [],
    waiting_on: {},
    owner_results: undefined,
  })
  assert.deepEqual(result, { action: 'wait', owners: ['t1'] })

  // Twelve strays, all owned by t1, still yield owners: ['t1'].
  const twelveStrays = Array.from({ length: 12 }, (_, i) => ({ ref: `.claude/agents/x${i}.md`, owner: 't1' }))
  const dedupResult = boundaryRepair({
    task_id: 't2', strays: twelveStrays, needs_from_sibling: [],
    siblings: [{ id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/' }] }],
    repair_used: false, violations: [], waiting_on: {}, owner_results: undefined,
  })
  assert.equal(dedupResult.action, 'wait')
  assert.deepEqual(dedupResult.owners, ['t1'])
})

test('AC-3: boundaryRepair returns "rerun" with base_branch from the first owner and merge_branches from the rest, once every owner has passed', () => {
  const { boundaryRepair } = loadB5Decisions()

  const oneOwner = boundaryRepair({
    task_id: 't2',
    strays: [{ ref: '.claude/agents/x.md', owner: 't1' }],
    needs_from_sibling: [],
    siblings: [{ id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/' }] }],
    repair_used: false, violations: [], waiting_on: {},
    owner_results: { t1: { passed: true, branch: 'task/t1' } },
  })
  assert.equal(oneOwner.action, 'rerun')
  assert.deepEqual(oneOwner.owners, ['t1'])
  assert.equal(oneOwner.base_branch, 'task/t1')
  assert.deepEqual(oneOwner.merge_branches, [])

  const twoOwners = boundaryRepair({
    task_id: 't2',
    strays: [
      { ref: '.claude/agents/x.md', owner: 't1' },
      { ref: '.claude/agents/y.md', owner: 't3' },
    ],
    needs_from_sibling: [],
    siblings: [
      { id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/x.md' }] },
      { id: 't3', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/y.md' }] },
    ],
    repair_used: false, violations: [], waiting_on: {},
    owner_results: { t1: { passed: true, branch: 'task/t1' }, t3: { passed: true, branch: 'task/t3' } },
  })
  assert.equal(twoOwners.action, 'rerun')
  assert.equal(twoOwners.base_branch, 'task/t1', 'the first owner (first-seen order) supplies base_branch')
  assert.deepEqual(twoOwners.merge_branches, ['task/t3'])
})

test('AC-4: boundaryRepair escalates with reason "owner_failed" naming the owners when any owner did not pass or has no result at all', () => {
  const { boundaryRepair } = loadB5Decisions()

  const base = {
    task_id: 't2',
    strays: [
      { ref: '.claude/agents/x.md', owner: 't1' },
      { ref: '.claude/agents/y.md', owner: 't3' },
    ],
    needs_from_sibling: [],
    siblings: [
      { id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/x.md' }] },
      { id: 't3', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/y.md' }] },
    ],
    repair_used: false, violations: [], waiting_on: {},
  }

  const failedOwner = boundaryRepair({ ...base, owner_results: { t1: { passed: false, branch: 'task/t1' }, t3: { passed: true, branch: 'task/t3' } } })
  assert.equal(failedOwner.action, 'escalate')
  assert.equal(failedOwner.reason, 'owner_failed')
  assert.ok(JSON.stringify(failedOwner).includes('t1'), 'must name the failed owner')

  const missingOwner = boundaryRepair({ ...base, owner_results: { t1: { passed: true, branch: 'task/t1' } } })
  assert.equal(missingOwner.action, 'escalate')
  assert.equal(missingOwner.reason, 'owner_failed')
  assert.ok(JSON.stringify(missingOwner).includes('t3'), 'must name the owner with no result at all')
})

test('AC-5: boundaryRepair escalates with reason "repair_used" whenever this task has already spent its one repair, regardless of owner_results', () => {
  const { boundaryRepair } = loadB5Decisions()
  const base = {
    task_id: 't2',
    strays: [{ ref: '.claude/agents/x.md', owner: 't1' }],
    needs_from_sibling: [],
    siblings: [{ id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/' }] }],
    repair_used: true, violations: [], waiting_on: {},
  }

  const withoutResults = boundaryRepair({ ...base, owner_results: undefined })
  assert.equal(withoutResults.action, 'escalate')
  assert.equal(withoutResults.reason, 'repair_used')

  const withPassingResults = boundaryRepair({ ...base, owner_results: { t1: { passed: true, branch: 'task/t1' } } })
  assert.equal(withPassingResults.action, 'escalate')
  assert.equal(withPassingResults.reason, 'repair_used')

  for (const r of [withoutResults, withPassingResults]) {
    assert.notEqual(r.action, 'wait')
    assert.notEqual(r.action, 'rerun')
  }
})

test('AC-6: boundaryRepair escalates with reason "mutual" before ever returning "wait", in both the violations-shaped and waiting_on-shaped mutual cases', () => {
  const { boundaryRepair } = loadB5Decisions()
  const siblings = [{ id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/' }] }]

  const violationsShaped = boundaryRepair({
    task_id: 't2',
    strays: [{ ref: '.claude/agents/x.md', owner: 't1' }],
    needs_from_sibling: [],
    siblings,
    repair_used: false,
    violations: [{ straying_task_id: 't1', strays: [{ ref: 'some/t2/path.js', owner: 't2' }] }],
    waiting_on: {},
    owner_results: undefined,
  })
  assert.equal(violationsShaped.action, 'escalate')
  assert.equal(violationsShaped.reason, 'mutual')

  const waitingOnShaped = boundaryRepair({
    task_id: 't2',
    strays: [{ ref: '.claude/agents/x.md', owner: 't1' }],
    needs_from_sibling: [],
    siblings,
    repair_used: false,
    violations: [],
    waiting_on: { t1: ['t2'] },
    owner_results: undefined,
  })
  assert.equal(waitingOnShaped.action, 'escalate')
  assert.equal(waitingOnShaped.reason, 'mutual')
})

test('AC-7: boundaryRepair routes needs_from_sibling through wait/rerun/escalate/proceed the same way it routes strays', () => {
  const { boundaryRepair } = loadB5Decisions()
  const siblings = [{ id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/agents/x.md' }] }]
  const base = {
    task_id: 't2',
    strays: [],
    needs_from_sibling: [{ surface: '.claude/agents/x.md', what: 'agentType names' }],
    siblings, repair_used: false, violations: [], waiting_on: {},
  }

  const waiting = boundaryRepair({ ...base, owner_results: undefined })
  assert.deepEqual(waiting, { action: 'wait', owners: ['t1'] })

  const rerun = boundaryRepair({ ...base, owner_results: { t1: { passed: true, branch: 'task/t1' } } })
  assert.equal(rerun.action, 'rerun')
  assert.equal(rerun.base_branch, 'task/t1')

  const unowned = boundaryRepair({
    task_id: 't2', strays: [], needs_from_sibling: [{ surface: '.claude/nobody/x.md', what: 'something' }],
    siblings, repair_used: false, violations: [], waiting_on: {}, owner_results: undefined,
  })
  assert.equal(unowned.action, 'escalate')
  assert.equal(unowned.reason, 'need_unowned')

  const proceed = boundaryRepair({
    task_id: 't2', strays: [], needs_from_sibling: [],
    siblings, repair_used: false, violations: [], waiting_on: {}, owner_results: undefined,
  })
  assert.equal(proceed.action, 'proceed')
})

test('AC-21: unaccountedTestFiles returns [] with an empty requested_paths list, and otherwise the tests_found entries missing from tests_landed and tests_skipped', () => {
  const { unaccountedTestFiles } = loadB5Decisions()

  const preexisting24 = Array.from({ length: 24 }, (_, i) => `pre-existing-${i}.test.js`)
  assert.deepEqual(
    unaccountedTestFiles({ requested_paths: [], tests_found: preexisting24, tests_landed: [], tests_skipped: [] }),
    [],
    'an empty requested_paths list must never produce an unaccounted list, no matter how many pre-existing tests exist',
  )

  const result = unaccountedTestFiles({
    requested_paths: ['substrate/test/b5-new.test.js'],
    tests_found: ['b5-new.test.js', 'landed.test.js', 'skipped.test.js', 'stray.test.js'],
    tests_landed: ['landed.test.js'],
    tests_skipped: ['skipped.test.js'],
  })
  assert.deepEqual(result.slice().sort(), ['b5-new.test.js', 'stray.test.js'].sort())
})
