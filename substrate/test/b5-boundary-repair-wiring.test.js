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
import { functionNamed, enclosingFunction, callSites, reachersOf, firstCallOf } from './b5-wiring-helpers.js'

// k9d: the AC-8/9/11/13/16/20 tests below were rewritten by the main session (direct drive of k9b). The k9b
// versions located things by first TEXTUAL occurrence — the definition of boundaryRepair inside the fix-loop
// block rather than a call, a variable name rather than the output field, the word depends_on rather than
// the dependency branches it resolves to, a backtick the source never used — so they failed on correct
// wiring, and a fixer bent the code to satisfy one. These assert CALLS and their order inside runTask, via
// b5-wiring-helpers.js, so they go red when the wiring changes and stay green when a declaration moves.
const consults = (text) => { const r = reachersOf(text, 'boundaryRepair'); r.delete('runTask'); return r }

test('AC-8: a violation verdict at both the settled-ChangeSet site and the round-level site calls boundaryRepair before its escalation can be reached', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const R = consults(text)
  const sites = [
    ['settled-ChangeSet', text.indexOf('let changeSet1 = cs')],
    ['round-level', text.indexOf('ctx.changeSet = { ...merged')],
  ]
  for (const [name, anchor] of sites) {
    assert.ok(anchor > rt.bodyStart && anchor < rt.bodyEnd, `expected the ${name} anchor inside runTask`)
    const check = callSites(text, 'boundaryCheck', anchor, rt.bodyEnd)[0]
    assert.ok(check, `expected a boundaryCheck( call at the ${name} site`)
    // The violation branch: from that check to the task's own `passed: false` return.
    const branchEnd = text.indexOf('passed: false', check)
    assert.ok(branchEnd > check, `expected the ${name} violation branch to end the task with passed: false`)
    const repair = firstCallOf(text, R, check, branchEnd)
    assert.ok(repair > 0, `the ${name} violation branch must call boundaryRepair (directly or via ${[...R].join('/')})`)
    const directEscalate = callSites(text, 'escalateBoundaryViolation', check, branchEnd)
    assert.ok(directEscalate.every(i => i > repair), `the ${name} site must consult boundaryRepair before any direct escalation`)
  }
  // Every Escalation a boundary violation writes still goes through the existing path.
  const esc = functionNamed(text, 'escalateBoundaryViolation')
  const escBody = text.slice(esc.bodyStart, esc.bodyEnd)
  assert.match(escBody, /escalations\.push/)
  assert.match(escBody, /reason: 'no_fresh_findings'/)
  assert.match(escBody, /sibling task/)
})

test('AC-9: a "rerun" decision drives a fresh impl:-labelled agent call on a new branch distinct from task/<task.id>, merging the decision\'s base and merge branches and the task\'s original dependency branches first', () => {
  const text = readWorkflowText()
  const label = text.search(/label:\s*`impl:\$\{task\.id\}[^`]*repair[^`]*`/i)
  assert.ok(label >= 0, 'expected an impl:-prefixed agent label naming the boundary-repair rerun')
  const fn = enclosingFunction(text, label)
  const body = text.slice(fn.bodyStart, fn.bodyEnd)
  assert.equal(callSites(body, 'agent').length, 1, 'the rerun function makes exactly one agent() call')
  assert.match(body, /decision\.base_branch|base_branch/, 'the rerun branches from the decision\'s base_branch')
  assert.match(body, /merge_branches/, 'the rerun merges the decision\'s merge_branches')
  // The task's own dependencies, as the branches they PASSED on (a repaired dependency passed on its repair
  // branch, and task/<dep> is its abandoned stray — the k9d defect).
  assert.match(body, /\bdeps\b[^\n]*depBranch|depBranch[^\n]*\bdeps\b/, 'the rerun merges the task\'s dependency RESULT branches')
  assert.match(body, /worktree add -b/, 'expected a new worktree on a new branch')
  assert.match(body, /task\/\$\{task\.id\}-repair/, 'expected a repair branch derived from task.id, distinct from task/${task.id}')
  assert.match(body, /base_commit/, 'expected base_commit taken after the merges')
  // And it is the rerun's branch, not task/<id>, that the task result later carries.
  assert.match(body, /branch\s*=\s*repairBranch/, 'the rerun reassigns the task\'s branch to the repair branch')
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
  const label = text.search(/label:\s*`impl:\$\{task\.id\}[^`]*repair[^`]*`/i)
  const rerunFn = enclosingFunction(text, label)
  const callers = [...new Set(callSites(text, rerunFn.name).map(i => enclosingFunction(text, i).name))]
  assert.equal(callers.length, 1, `expected exactly one caller of ${rerunFn.name}`)
  const caller = functionNamed(text, callers[0])
  const call = callSites(text, rerunFn.name, caller.bodyStart, caller.bodyEnd)[0]
  const spent = text.slice(caller.bodyStart, call).lastIndexOf('repair_used = true')
  assert.ok(spent >= 0, 'repair_used must be set true before the rerun, so the one repair is spent')
  const recheck = callSites(text, 'boundaryCheck', call, caller.bodyEnd)[0]
  assert.ok(recheck, 'expected boundaryCheck to run again on the rerun\'s ChangeSet')
  const reconsult = callSites(text, 'boundaryRepair', recheck, caller.bodyEnd)[0]
  assert.ok(reconsult, 'expected boundaryRepair to be consulted again after the re-check')
  const args = text.slice(reconsult, text.indexOf('})', reconsult))
  assert.match(args, /repair_used:\s*(true|ctx\.repair_used)/, 'the second consultation passes the spent repair_used')
  const after = text.slice(reconsult, caller.bodyEnd)
  assert.ok(callSites(after, 'escalateBoundaryViolation').length, 'a second stray reaches the existing escalation path')
})

test('AC-12: a strayer awaits its owners\' existing taskDone promises through a run-level waiting registry, with no new timer or poll', () => {
  const text = readWorkflowText()
  assert.doesNotMatch(text, /setInterval\(|setTimeout\(/, 'no new timer/poll may be introduced to implement the wait')
  assert.match(text, /taskDone/, 'expected the wait to reuse the existing taskDone promises rather than invent new ones')
  assert.match(text, /waiting_on/, 'expected a waiting_on argument threaded into boundaryRepair')
})

test('AC-13: the run output carries a boundary_repairs array, one pushed entry per attempt shaped {strayer, owners, base_branch, outcome}', () => {
  const text = readWorkflowText()
  const m = text.match(/boundary_repairs:\s*([A-Za-z_$][\w$]*)/)
  assert.ok(m, 'expected the returned output to carry a boundary_repairs field bound to a run-level array')
  const name = m[1]
  assert.match(text, new RegExp(`(const|let)\\s+${name}\\s*=\\s*\\[\\]`), 'boundary_repairs must start empty, so it is [] when nothing strayed')
  const pushes = callSites(text, `${name}.push`)
  assert.ok(pushes.length >= 1, 'expected entries pushed as repair attempts happen')
  const VALID = new Set(['repaired', 'strayed_again', 'owner_failed', 'mutual', 'repair_used', 'need_unowned'])
  for (const at of pushes) {
    const entry = text.slice(at, text.indexOf('})', at))
    for (const key of ['strayer', 'owners', 'base_branch', 'outcome']) assert.match(entry, new RegExp(`\\b${key}\\b`), `entry at ${at} lacks ${key}`)
    const lit = entry.match(/outcome:\s*'([a-z_]+)'/)
    if (lit) assert.ok(VALID.has(lit[1]), `outcome '${lit[1]}' is not one of the six named values`)
  }
})

test('AC-16: a non-empty needs_from_sibling on the implementer\'s ChangeSet is routed to boundaryRepair before the empty-diff gate and any run:/lens:/scope:/fix: label', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const read = text.indexOf('.needs_from_sibling', rt.bodyStart)
  assert.ok(read > 0 && read < rt.bodyEnd, 'expected runTask to read needs_from_sibling from the implementer\'s ChangeSet')
  const route = firstCallOf(text, consults(text), read, rt.bodyEnd)
  assert.ok(route > 0, 'expected that read to be routed to boundaryRepair')
  // The routing must be conditioned on the needs actually read, not on a constant or something unrelated.
  const guard = text.slice(text.lastIndexOf('\n  if (', route), route)
  const needsVar = text.slice(text.lastIndexOf('\n', read), read).match(/const (\w+) =/)?.[1]
  assert.ok(needsVar && new RegExp(`if \\(${needsVar}\\.length\\)`).test(guard), `the routing call must be guarded by the needs read (${needsVar}), not by anything else`)
  assert.ok(new RegExp(`\\(\\[\\], ${needsVar}\\)`).test(text.slice(route, route + 80)), 'the routing call must pass the needs it read')
  const gate = callSites(text, 'emptyDiffAction', rt.bodyStart, rt.bodyEnd)[0]
  assert.ok(gate > 0, 'expected the existing emptyDiffAction( call in runTask')
  assert.ok(route < gate, 'the needs_from_sibling routing must run before the empty-diff gate')
  for (const label of ['`run:${task.id}', '`lens:', '`scope:', '`fix:']) {
    const idx = text.indexOf(label, rt.bodyStart)
    if (idx >= 0 && idx < rt.bodyEnd) assert.ok(route < idx, `the routing must run before the first "${label}" agent label`)
  }
})

test('AC-20: with zero passing tasks, Integrate calls neither the integrate agent nor integrate:resolve, and reports a no-passing-task output', () => {
  const text = readWorkflowText()
  const label = text.search(/label:\s*['"`]integrate['"`]/)
  assert.ok(label >= 0, 'expected the existing integrate agent label')
  const call = text.lastIndexOf('agent(', label)
  const stmt = text.lastIndexOf('\n', call)
  assert.match(text.slice(stmt, call), /passing\.length/, 'the integrate agent() call must be guarded by passing.length in the same statement')
  const resolve = text.search(/label:\s*['"`]integrate:resolve['"`]/)
  const guardOfResolve = text.slice(text.lastIndexOf('\nif (', resolve), resolve)
  assert.match(guardOfResolve, /suite\s*&&/, 'integrate:resolve runs only when a suite exists, which it never does with no passing task')
  assert.match(text, /no\s+(passing\s+task|task\s+passed)|nothing\s+to\s+integrate/i, 'expected a log line stating there is nothing to integrate')
  assert.match(text, /results_ref:\s*''/)
  assert.match(text, /passed:\s*0/)
  assert.match(text, /failed:\s*0/)
  assert.match(text, /tests_landed:\s*\[\]/)
  assert.match(text, /tests_skipped:\s*\[\]/)
})


test('k9d: a dependent task branches from, and merges, each dependency\'s RESULT branch — never task/<dep>, which a boundary repair abandons', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const body = text.slice(rt.bodyStart, rt.bodyEnd)
  const base = body.match(/const base = [^\n]*/)?.[0]
  const merges = body.match(/const extraMerges = [^\n]*/)?.[0]
  assert.ok(base && merges, 'expected runTask to compute base and extraMerges from its dependencies')
  for (const line of [base, merges]) {
    assert.doesNotMatch(line, /`task\/\$\{d(eps\[[^\]]*\])?\.task\.id\}`/, `must not rebuild task/<dep> from the id: ${line}`)
    assert.match(line, /depBranch/, `must use the dependency result branch: ${line}`)
  }
  const def = body.match(/const depBranch = \(d\) => ([^\n]*)/)?.[1]
  assert.ok(def && /d\.branch/.test(def), 'depBranch must read the dependency result\'s own branch field')
})
