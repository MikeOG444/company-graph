// Source-text wiring tests for spec-wi-b5-sibling-value-repair: how boundaryRepair, the
// needs_from_sibling routing, the repair rerun, its Integrate consumption and the boundary_repairs
// output field are wired into .claude/workflows/build-implement.js, plus the zero-passing-tasks
// Integrate guard. Covers AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-16, AC-20.
//
// Written from the spec (ledger/runs/k8/spec-wi-b5-sibling-value-repair.json) ONLY, anchored on
// call sites and literal source fragments the spec itself quotes (e.g. "let changeSet1 = cs",
// "ctx.changeSet = { ...merged"), in the same source-text style as
// substrate/test/boundary-wiring.test.js and substrate/test/dispute-unruled.test.js. Where the
// spec says "for example" about a naming choice (AC-9's task/<task.id>-repair), the assertion
// below is written to accept that example without over-constraining an equally valid different
// spelling of the same behaviour.
//
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). Repository paths are resolved only through the
// existing extract-fixloop.js sentinel extractor, never by counting ".." from this file's own
// location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'

test('AC-8: a violation verdict at both the settled-ChangeSet site and the round-level site calls boundaryRepair before its escalation can be reached', () => {
  const text = readWorkflowText()

  const settledIdx = text.indexOf('let changeSet1 = cs')
  assert.ok(settledIdx >= 0, 'expected the existing empty-diff resolution assigning changeSet1')
  const settledBoundaryIdx = text.indexOf('boundaryCheck(', settledIdx)
  assert.ok(settledBoundaryIdx > settledIdx, 'expected a boundaryCheck( call on the settled ChangeSet')
  const settledEscalateIdx = text.indexOf('escalations.push', settledBoundaryIdx)
  assert.ok(settledEscalateIdx > settledBoundaryIdx, 'expected the settled-ChangeSet violation branch to still push an Escalation')
  const settledRepairIdx = text.indexOf('boundaryRepair(', settledBoundaryIdx)
  assert.ok(settledRepairIdx > settledBoundaryIdx && settledRepairIdx < settledEscalateIdx,
    'the settled-ChangeSet site must consult boundaryRepair before its escalation can be reached')

  const roundIdx = text.indexOf('ctx.changeSet = { ...merged')
  assert.ok(roundIdx >= 0, 'expected the existing merged-ChangeSet assignment onto ctx.changeSet')
  const roundBoundaryIdx = text.indexOf('boundaryCheck(', roundIdx)
  assert.ok(roundBoundaryIdx > roundIdx, 'expected a boundaryCheck( call on each round\'s merged ChangeSet')
  const roundEscalateIdx = text.indexOf('escalations.push', roundBoundaryIdx)
  assert.ok(roundEscalateIdx > roundBoundaryIdx, 'expected the round-level violation branch to still push an Escalation')
  const roundRepairIdx = text.indexOf('boundaryRepair(', roundBoundaryIdx)
  assert.ok(roundRepairIdx > roundBoundaryIdx && roundRepairIdx < roundEscalateIdx,
    'the round-level site must also consult boundaryRepair before its escalation can be reached')
})

test('AC-9: a "rerun" decision drives a fresh impl:-labelled agent call on a new branch distinct from task/<task.id>, merging the decision\'s base and merge branches and the task\'s original dependency branches first', () => {
  const text = readWorkflowText()

  const repairLabelMatches = [...text.matchAll(/label:\s*`impl:\$\{task\.id\}[^`]*`/g)].filter(m => /repair/i.test(m[0]))
  assert.ok(repairLabelMatches.length >= 1, 'expected an impl:-prefixed agent label naming the boundary-repair rerun')

  const repairLabelIdx = repairLabelMatches[0].index
  const agentStart = text.lastIndexOf('agent(', repairLabelIdx)
  assert.ok(agentStart >= 0, 'expected a preceding agent( call for the repair label')
  const before = text.slice(Math.max(0, agentStart - 4000), agentStart)

  assert.match(before, /merge_branches/, 'expected the rerun wiring to read the decision\'s merge_branches before implementing')
  assert.match(before, /base_branch/, 'expected the rerun wiring to read the decision\'s base_branch before implementing')
  assert.match(before, /depends_on/, 'expected the rerun to also merge the task\'s original dependency branches')
  assert.match(before, /worktree add/, 'expected a new worktree to be created for the repair rerun')

  // A fresh branch distinct from the bare task/${task.id} branch: something built from
  // task.id plus a "repair" marker (the spec's own example is task/<task.id>-repair).
  assert.match(before + text.slice(agentStart, repairLabelIdx), /task\/\$\{task\.id\}[^`'"\n]*repair/i,
    'expected a fresh repair branch name derived from task.id, distinct from the bare task/${task.id} branch')

  assert.match(before + text.slice(agentStart, repairLabelIdx + 200), /base_commit/,
    'expected base_commit to be recomputed after merging, so the repair diff contains only the strayer\'s own work')
})

test('AC-10: a repaired task\'s result branch is the fresh repair branch, and that is what passingBranches merges', () => {
  const text = readWorkflowText()
  assert.match(text, /passingBranches/, 'expected the existing passingBranches branch list feeding Integrate')

  const repairLabelIdx = text.search(/label:\s*`impl:\$\{task\.id\}[^`]*repair[^`]*`/i)
  assert.ok(repairLabelIdx >= 0, 'expected the repair-rerun agent label')

  // Somewhere at or after the repair rerun, the task's own result branch must be reassigned to the
  // repair branch rather than left at the original task/${task.id} branch, so that whatever feeds
  // passingBranches picks up the repair branch instead.
  const after = text.slice(repairLabelIdx, repairLabelIdx + 4000)
  assert.match(after, /branch\s*[:=]/,
    'expected the repair rerun\'s result to carry a branch field, reassigned from the fresh repair branch')
})

test('AC-11: the repair rerun\'s ChangeSet is boundary-checked again with repair_used: true, reaching the existing escalation path on a second stray', () => {
  const text = readWorkflowText()
  const repairLabelIdx = text.search(/label:\s*`impl:\$\{task\.id\}[^`]*repair[^`]*`/i)
  assert.ok(repairLabelIdx >= 0, 'expected the repair-rerun agent label')

  const afterRepairBoundaryIdx = text.indexOf('boundaryCheck(', repairLabelIdx)
  assert.ok(afterRepairBoundaryIdx > repairLabelIdx, 'expected boundaryCheck to run again on the repair rerun\'s ChangeSet')

  const afterRepairRepairIdx = text.indexOf('boundaryRepair(', afterRepairBoundaryIdx)
  assert.ok(afterRepairRepairIdx > afterRepairBoundaryIdx, 'expected boundaryRepair to be consulted again after the rerun')

  const call = text.slice(afterRepairRepairIdx, afterRepairRepairIdx + 600)
  assert.match(call, /repair_used:\s*true/, 'the second boundaryRepair consultation must pass repair_used: true')
})

test('AC-12: a strayer awaits its owners\' existing taskDone promises through a run-level waiting registry, with no new timer or poll', () => {
  const text = readWorkflowText()
  assert.doesNotMatch(text, /setInterval\(|setTimeout\(/, 'no new timer/poll may be introduced to implement the wait')
  assert.match(text, /taskDone/, 'expected the wait to reuse the existing taskDone promises rather than invent new ones')
  assert.match(text, /waiting_on/, 'expected a waiting_on argument threaded into boundaryRepair')
})

test('AC-13: the run output carries a boundary_repairs array, one pushed entry per attempt shaped {strayer, owners, base_branch, outcome}', () => {
  const text = readWorkflowText()
  assert.match(text, /boundary_repairs/, 'expected a boundary_repairs field on the returned output')
  assert.match(text, /boundary_repairs\s*[:=]\s*\[\]/, 'boundary_repairs must default to an empty array when nothing strayed')
  assert.match(text, /boundary_repairs\.push\(/, 'expected boundary_repairs entries to be pushed as repair attempts happen')

  const pushIdx = text.indexOf('boundary_repairs.push(')
  const entry = text.slice(pushIdx, pushIdx + 500)
  for (const key of ['strayer', 'owners', 'base_branch', 'outcome']) {
    assert.match(entry, new RegExp(key), `expected the pushed boundary_repairs entry to carry ${key}`)
  }

  const VALID_OUTCOMES = ['repaired', 'strayed_again', 'owner_failed', 'mutual', 'repair_used', 'need_unowned']
  assert.ok(VALID_OUTCOMES.some(o => text.includes(`'${o}'`) || text.includes(`"${o}"`)),
    'expected at least one of the six named outcome values to appear as a literal near the boundary_repairs bookkeeping')
})

test('AC-16: a non-empty needs_from_sibling on the implementer\'s ChangeSet is routed to boundaryRepair before the empty-diff gate and any run:/lens:/scope:/fix: label', () => {
  const text = readWorkflowText()
  assert.match(text, /needs_from_sibling/, 'expected needs_from_sibling to be read from the implementer\'s ChangeSet')

  const firstRepairIdx = text.indexOf('boundaryRepair(')
  const firstEmptyDiffIdx = text.indexOf('emptyDiffAction(')
  assert.ok(firstRepairIdx >= 0, 'expected at least one boundaryRepair( call site')
  assert.ok(firstEmptyDiffIdx >= 0, 'expected the existing emptyDiffAction( call site')
  assert.ok(firstRepairIdx < firstEmptyDiffIdx, 'boundaryRepair must be consulted before the empty-diff gate, since an implementer that asks may legitimately return an empty diff')

  for (const label of ['`run:${task.id}', '`lens:', '`scope:', '`fix:']) {
    const idx = text.indexOf(label)
    if (idx >= 0) assert.ok(firstRepairIdx < idx, `boundaryRepair must be consulted before the first "${label}" agent label`)
  }
})

test('AC-20: with zero passing tasks, Integrate calls neither the integrate agent nor integrate:resolve, and reports a no-passing-task output', () => {
  const text = readWorkflowText()

  const integrateLabelIdx = text.indexOf('label: `integrate')
  assert.ok(integrateLabelIdx >= 0, 'expected the existing integrate agent label')

  const guardIdx = text.lastIndexOf('passing.length', integrateLabelIdx)
  assert.ok(guardIdx >= 0 && guardIdx < integrateLabelIdx,
    'a check on passing.length must sit in the source before the "integrate" agent() call')

  assert.match(text, /no\s+(passing\s+task|task\s+passed)|nothing\s+to\s+integrate/i,
    'expected a log line stating there is no passing task and nothing to integrate')
  assert.match(text, /results_ref:\s*''/, 'expected the zero-passing suite to report an empty results_ref, not a merged branch name')
  assert.match(text, /passed:\s*0/, 'expected the zero-passing suite to report 0 passed')
  assert.match(text, /failed:\s*0/, 'expected the zero-passing suite to report 0 failed')
  assert.match(text, /tests_landed:\s*\[\]/, 'expected an empty tests_landed on the zero-passing output')
  assert.match(text, /tests_skipped:\s*\[\]/, 'expected an empty tests_skipped on the zero-passing output')
})
