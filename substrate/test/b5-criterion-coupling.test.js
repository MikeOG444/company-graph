// Tests for spec-wi-b5-sibling-value-repair AC-17, AC-18, AC-19: the sixth graph-lint check,
// checkCriterionCoupling, in .claude/workflows/build-spec.js. It catches a criterion coupling two
// tasks' owned paths when no depends_on path joins those tasks.
//
// Written from the spec (ledger/runs/k8/spec-wi-b5-sibling-value-repair.json) ONLY: every
// scenario below is transcribed from the acceptance criteria's own given/when/then, not from
// reading the implementation. Follows the new Function loader idiom of
// substrate/test/graph-lint-helpers.js's own loadGraphLint(), but built independently here (the
// way substrate/test/dispute-unruled.test.js builds its own loader rather than editing
// substrate/test/extract-fixloop.js) so this TestSet does not have to touch a file another task's
// TestSet already committed.
//
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). Repository paths are resolved only through the
// existing graph-lint-helpers.js sentinel extractor (readWorkflowText/extractBlock), never by
// counting ".." from this file's own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readWorkflowText, extractBlock, BEGIN_SENTINEL, END_SENTINEL,
  surf, crit, task, spec, graph,
} from './graph-lint-helpers.js'

// Loads the graph-lint sentinel block and returns the nine pre-existing functions plus
// checkCriterionCoupling, exactly the way AC-17 describes.
function loadGraphLintWithCoupling() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('graph-lint block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return {
      surfaceRef, withinOwned, criterionPaths, classifyCriterion,
      checkCriterionReachability, checkFalseEdges, checkCriterionCoverage, checkTestSurfaces, lintGraph,
      checkCriterionCoupling,
    }`)
  return factory()
}

test('AC-17: checkCriterionCoupling exists, is pure, shaped ({ spec, graph }) => { violations, warnings }, and its violations feed lintGraph (gate_required true when it fires)', () => {
  const text = readWorkflowText()
  const { block, beginCount, endCount } = extractBlock(text)
  assert.equal(beginCount, 1)
  assert.equal(endCount, 1)
  assert.ok(block && block.trim().length > 0)

  const lint = loadGraphLintWithCoupling()
  assert.equal(typeof lint.checkCriterionCoupling, 'function', 'checkCriterionCoupling must be a function')

  // Purity / no runtime handles: calling it directly on plain-object fixtures must not throw.
  const s = spec('s1', { acceptance: [crit('AC-1', 'no path named here at all')], touched: ['a/b.js'] })
  const g = graph('s1', [task('t1', { owns: ['a/b.js'], criteria: ['AC-1'] })])
  const direct = lint.checkCriterionCoupling({ spec: s, graph: g })
  assert.ok('violations' in direct && 'warnings' in direct, 'checkCriterionCoupling must return { violations, warnings }')
  assert.ok(Array.isArray(direct.violations))
  assert.ok(Array.isArray(direct.warnings))

  // The header comment (whatever it says) must now describe six checks, not five.
  const headerComment = text.slice(text.indexOf(BEGIN_SENTINEL), text.indexOf(BEGIN_SENTINEL) + 2000)
  assert.match(headerComment, /six checks|6 checks/i, 'expected the block\'s header comment to say it now has six checks')

  // Coupled fixture from AC-18: lintGraph must fold checkCriterionCoupling's violations in and gate.
  const coupledSpec = spec('s-couple', {
    touched: ['a/x.js', 'b/y.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and b/y.js consistent with the new rule')],
  })
  const coupledGraph = graph('s-couple', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
    task('t2', { owns: ['b/y.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
  ])
  const result = lint.lintGraph({ spec: coupledSpec, graph: coupledGraph, test_dir: 'substrate/test' })
  assert.ok(result.violations.some(v => v.check === 'criterion_coupling'), 'lintGraph must include checkCriterionCoupling\'s violations')
  assert.equal(result.gate_required, true, 'a criterion_coupling violation must set gate_required true')
})

test('AC-18: two tasks whose owned paths are both named by one criterion, with no depends_on path between the tasks, is exactly one criterion_coupling violation naming both tasks, criterion and paths', () => {
  const lint = loadGraphLintWithCoupling()
  const s = spec('s-couple', {
    touched: ['a/x.js', 'b/y.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and b/y.js consistent with the new rule')],
  })
  const g = graph('s-couple', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
    task('t2', { owns: ['b/y.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
  ])

  const { violations } = lint.checkCriterionCoupling({ spec: s, graph: g })
  assert.equal(violations.length, 1)
  assert.deepEqual(violations[0], {
    check: 'criterion_coupling',
    criterion: 'AC-1',
    tasks: ['t1', 't2'],
    paths: { t1: ['a/x.js'], t2: ['b/y.js'] },
  })
})

test('AC-18: a depends_on path between the two tasks -- direct either direction, or transitive through a third task -- clears the violation', () => {
  const lint = loadGraphLintWithCoupling()
  const s = spec('s-couple', {
    touched: ['a/x.js', 'b/y.js', 'c/z.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and b/y.js consistent with the new rule')],
  })

  const directForward = graph('s-couple', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
    task('t2', { owns: ['b/y.js'], criteria: ['AC-1'], spec_id: 's-couple', deps: ['t1'] }),
  ])
  assert.equal(lint.checkCriterionCoupling({ spec: s, graph: directForward }).violations.length, 0, 't2 depends_on t1 must clear the violation')

  const directBackward = graph('s-couple', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-couple', deps: ['t2'] }),
    task('t2', { owns: ['b/y.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
  ])
  assert.equal(lint.checkCriterionCoupling({ spec: s, graph: directBackward }).violations.length, 0, 't1 depends_on t2 must clear the violation')

  const transitive = graph('s-couple', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-couple' }),
    task('t3', { owns: ['c/z.js'], criteria: [], spec_id: 's-couple', deps: ['t1'] }),
    task('t2', { owns: ['b/y.js'], criteria: ['AC-1'], spec_id: 's-couple', deps: ['t3'] }),
  ])
  assert.equal(lint.checkCriterionCoupling({ spec: s, graph: transitive }).violations.length, 0, 'a transitive depends_on chain through a third task must clear the violation')
})

test('AC-19: a criterion naming a path owned by only one task, a path owned by no task, or naming no path at all never yields a criterion_coupling violation or warning', () => {
  const lint = loadGraphLintWithCoupling()

  const oneOwnerSpec = spec('s-one', {
    touched: ['a/x.js', 'a/y.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and a/y.js both consistent')],
  })
  const oneOwnerGraph = graph('s-one', [
    task('t1', { owns: ['a/x.js', 'a/y.js'], criteria: ['AC-1'], spec_id: 's-one' }),
  ])
  const oneOwnerResult = lint.checkCriterionCoupling({ spec: oneOwnerSpec, graph: oneOwnerGraph })
  assert.equal(oneOwnerResult.violations.length, 0)
  assert.equal(oneOwnerResult.warnings.length, 0)

  const unownedPathSpec = spec('s-unowned', {
    touched: ['a/x.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and nobody/owns/this.js consistent')],
  })
  const unownedPathGraph = graph('s-unowned', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-unowned' }),
  ])
  const unownedResult = lint.checkCriterionCoupling({ spec: unownedPathSpec, graph: unownedPathGraph })
  assert.equal(unownedResult.violations.length, 0)
  assert.equal(unownedResult.warnings.length, 0)

  const noPathSpec = spec('s-nopath', {
    touched: ['a/x.js', 'b/y.js'],
    acceptance: [crit('AC-1', 'the output reads clearly to a new user')],
  })
  const noPathGraph = graph('s-nopath', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-nopath' }),
    task('t2', { owns: ['b/y.js'], criteria: [], spec_id: 's-nopath' }),
  ])
  const noPathResult = lint.checkCriterionCoupling({ spec: noPathSpec, graph: noPathGraph })
  assert.equal(noPathResult.violations.length, 0)
  assert.equal(noPathResult.warnings.length, 0)
})

test('AC-19: only a path a task actually OWNS counts toward coupling -- a criterion naming a path merely inside spec.touched_surfaces but not in any task\'s owned_surfaces is not a coupling, mirroring criterion_reachability\'s own distinction', () => {
  const lint = loadGraphLintWithCoupling()
  const s = spec('s-touched-not-owned', {
    touched: ['a/x.js', 'b/y.js', 'c/unowned.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and c/unowned.js consistent with the new rule')],
  })
  const g = graph('s-touched-not-owned', [
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-touched-not-owned' }),
    task('t2', { owns: ['b/y.js'], criteria: [], spec_id: 's-touched-not-owned' }),
  ])
  const result = lint.checkCriterionCoupling({ spec: s, graph: g })
  assert.equal(result.violations.length, 0, 'c/unowned.js is touched but owned by no task, so it cannot couple t1 to anything')
})

test('k9d: two tasks that only SHARE a dependency still run in parallel, so a criterion coupling them is still a violation', () => {
  // The k9b implementation checked undirected connectivity: t1 -> t0 <- t2 read as "joined". The runtime
  // starts t1 and t2 together once t0 passes, so neither can see the other's values — the k7 failure.
  const lint = loadGraphLintWithCoupling()
  const s = spec('s-couple', {
    touched: ['a/x.js', 'b/y.js', 'c/z.js'],
    acceptance: [crit('AC-1', 'keeps a/x.js and b/y.js consistent with the new rule')],
  })
  const commonParent = graph('s-couple', [
    task('t0', { owns: ['c/z.js'], criteria: [], spec_id: 's-couple' }),
    task('t1', { owns: ['a/x.js'], criteria: ['AC-1'], spec_id: 's-couple', deps: ['t0'] }),
    task('t2', { owns: ['b/y.js'], criteria: ['AC-1'], spec_id: 's-couple', deps: ['t0'] }),
  ])
  const { violations } = lint.checkCriterionCoupling({ spec: s, graph: commonParent })
  assert.equal(violations.length, 1, 'siblings under a common parent are unordered')
  assert.deepEqual(violations[0].tasks, ['t1', 't2'])
})
