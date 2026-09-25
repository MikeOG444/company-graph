// Tests for spec-wi-b3-graph-lint (task t-graph-lint), written from the Spec's acceptance criteria
// ONLY — no implementation of this task exists yet at authoring time, and none was read to write
// these. Each test is named after the criterion id it covers.
//
// Fixtures deliberately reproduce the three real defects the Spec cites as motivation, so every
// check is demonstrated FAILING on the shape that actually broke a run, not merely passing on a
// clean graph:
//   - k4: ten tasks, nine `depends_on: ['t-agent-definitions']` with no crossing variable (false
//     edges), and a coverage shape with AC-11/AC-12/AC-15/AC-16 orphaned and AC-8 claimed by all ten.
//   - t7: a criterion naming a file its task does not own (criterion unreachable from owned_surfaces).
//   - k2i: change-scoped criteria ("byte-identical to before", "the changed paths are exactly these
//     three", "no dependency is added") mixed with product-scoped ones.
//
// Lands under substrate/test/ (matched by `node --test substrate/test/*.test.js`); the basename
// `graph-lint` does not collide with any file already there. Never shells out to `npm test` or any
// other command — that is the exact fork bomb run k2i hit when a generated test re-ran the suite
// that was running it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readWorkflowText, extractBlock, loadGraphLint, BEGIN_SENTINEL, END_SENTINEL,
  surf, crit, task, spec, graph,
} from './graph-lint-helpers.js'

// ---- AC-1 ----

test('AC-1: the sentinel lines each occur exactly once and expose all nine graph-lint functions', () => {
  const { block, beginCount, endCount } = extractBlock(readWorkflowText())
  assert.equal(beginCount, 1, `expected exactly one "${BEGIN_SENTINEL}" line`)
  assert.equal(endCount, 1, `expected exactly one "${END_SENTINEL}" line`)
  assert.ok(block && block.trim().length > 0, 'expected a non-empty block between the sentinels')

  const lint = loadGraphLint()
  const NAMES = ['surfaceRef', 'withinOwned', 'criterionPaths', 'classifyCriterion',
    'checkCriterionReachability', 'checkFalseEdges', 'checkCriterionCoverage', 'checkTestSurfaces', 'lintGraph']
  for (const name of NAMES) assert.equal(typeof lint[name], 'function', `${name} must be a function`)
})

// ---- AC-2 ----

test('AC-2: the block is pure script code with no runtime handles, shell, import or nondeterminism', () => {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block && block.trim().length > 0, 'expected a non-empty graph-lint block between the sentinels')
  for (const token of ['import ', 'require(', 'fs.', 'Date.now(', 'Math.random(']) {
    assert.ok(!block.includes(token), `block must not contain "${token}"`)
  }
  assert.ok(!/child_process|execSync|spawnSync|spawn\(|exec\(/.test(block), 'block must not shell out')

  const lint = loadGraphLint()
  // Calling every exported function with plain-object fixtures must never throw a ReferenceError —
  // i.e. nothing in the block secretly closes over args/A/log/phase/agent/parallel/pipeline/budget.
  assert.doesNotThrow(() => lint.surfaceRef({ kind: 'path', ref: './a/b.js' }))
  assert.doesNotThrow(() => lint.withinOwned('a/b.js', ['a/']))
  assert.doesNotThrow(() => lint.criterionPaths(crit('AC-1', 'names a/b.js')))
  assert.doesNotThrow(() => lint.classifyCriterion(crit('AC-1', 'byte-identical to before')))
  const s = spec('s1', { acceptance: [crit('AC-1', 'no path named here at all')], touched: ['a/b.js'] })
  const g = graph('s1', [task('t1', { owns: ['a/b.js'], criteria: ['AC-1'] })])
  assert.doesNotThrow(() => lint.checkCriterionReachability(s, g))
  assert.doesNotThrow(() => lint.checkFalseEdges(s, g))
  assert.doesNotThrow(() => lint.checkCriterionCoverage(s, g))
  assert.doesNotThrow(() => lint.checkTestSurfaces(s, 'substrate/test'))
  assert.doesNotThrow(() => lint.lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' }))
})

// ---- AC-3 ----

test('AC-3: surfaceRef strips a schema fragment / leading "./" / trailing "/", and withinOwned is directory-aware', () => {
  const { surfaceRef, withinOwned } = loadGraphLint()
  assert.equal(surfaceRef({ ref: './contracts.schema.json#/$defs/Finding' }), 'contracts.schema.json')
  assert.equal(surfaceRef({ ref: 'substrate/test/' }), 'substrate/test')

  // Non-slash owned ref: exact match only.
  assert.equal(withinOwned('substrate/test/a.js', ['substrate/test']), false)
  assert.equal(withinOwned('substrate/test', ['substrate/test']), true)
  assert.equal(withinOwned('substrate/testing/x.js', ['substrate/test']), false)

  // Trailing-slash (directory-shaped) owned ref: covers itself and everything beneath.
  assert.equal(withinOwned('substrate/test', ['substrate/test/']), true)
  assert.equal(withinOwned('substrate/test/a.js', ['substrate/test/']), true)
  assert.equal(withinOwned('substrate/testing/x.js', ['substrate/test/']), false)
})

// ---- AC-4 (t7 fixture) ----

test('AC-4: a criterion naming a path its task does not own (t7 shape) is a criterion_reachability violation that gates', () => {
  const s = spec('spec-t7', {
    touched: ['.claude/workflows/build-implement.js', 'substrate/x.js'],
    acceptance: [crit('AC-1', 'the change keeps .claude/workflows/build-implement.js consistent with the new rule')],
  })
  const g = graph('spec-t7', [task('t-x', { owns: ['substrate/x.js'], criteria: ['AC-1'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  const hits = result.violations.filter(v => v.check === 'criterion_reachability')
  assert.equal(hits.length, 1, `expected exactly one criterion_reachability violation, got ${JSON.stringify(result.violations)}`)
  const str = JSON.stringify(hits[0])
  assert.ok(str.includes('t-x'), 'violation must name the task')
  assert.ok(str.includes('AC-1'), 'violation must name the criterion')
  assert.ok(str.includes('.claude/workflows/build-implement.js'), 'violation must name the offending path')
  assert.equal(result.gate_required, true)
})

// ---- AC-5 ----

test('AC-5: a directory-shaped owned_surfaces ref covers a criterion naming a file beneath it', () => {
  const s = spec('spec-dir', {
    touched: ['substrate/foo/'],
    acceptance: [crit('AC-1', 'writes substrate/foo/bar.js with the new option')],
  })
  const g = graph('spec-dir', [task('t1', { owns: ['substrate/foo/'], criteria: ['AC-1'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })
  assert.equal(result.violations.filter(v => v.check === 'criterion_reachability').length, 0)
})

// ---- AC-6 ----

test('AC-6: an un-pathed criterion and an out-of-scope path each warn, with distinct reasons, and never gate alone', () => {
  const s = spec('spec-warn', {
    touched: ['substrate/x.js'],
    acceptance: [
      crit('AC-1', 'the output reads clearly to a new user'),
      crit('AC-2', 'the file substrate/nowhere.js is updated to match'),
    ],
  })
  const g = graph('spec-warn', [task('t1', { owns: ['substrate/x.js'], criteria: ['AC-1', 'AC-2'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  assert.equal(result.violations.length, 0, `no path-related finding here should be a hard violation: ${JSON.stringify(result.violations)}`)
  const w1 = result.warnings.find(w => JSON.stringify(w).includes('AC-1'))
  const w2 = result.warnings.find(w => JSON.stringify(w).includes('AC-2'))
  assert.ok(w1, 'AC-1 (names no path) must produce a warning')
  assert.ok(w2, 'AC-2 (path not in Spec.touched_surfaces) must produce a warning')
  assert.match(JSON.stringify(w1), /names no path|no.{0,10}path/i)
  assert.match(JSON.stringify(w2), /not in.*touched_surfaces|touched_surfaces/i)
  assert.notEqual(JSON.stringify(w1).replace(/AC-1/g, ''), JSON.stringify(w2).replace(/AC-2/g, ''))
  assert.equal(result.gate_required, false)
})

// ---- AC-7 (k4 false-edge fixture) ----

test('AC-7: nine depends_on edges with no crossing variable (k4 shape) are nine false_edge violations', () => {
  const base = task('t-agent-definitions', { owns: ['.claude/agents/base.md'], criteria: ['AC-1'] })
  const acceptance = [crit('AC-1', 'defines the agent types used by every workflow task')]
  const deps = []
  for (let i = 1; i <= 9; i++) {
    const file = `.claude/workflows/wf${i}.js`
    acceptance.push(crit(`AC-${i + 1}`, `updates ${file} to add the new phase`))
    deps.push(task(`t-wf-${i}`, { owns: [file], deps: ['t-agent-definitions'], criteria: [`AC-${i + 1}`] }))
  }
  const s = spec('spec-k4-false-edge', { touched: ['.claude/agents/base.md', ...deps.map((_, i) => `.claude/workflows/wf${i + 1}.js`)], acceptance })
  const g = graph('spec-k4-false-edge', [base, ...deps])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  const falseEdges = result.violations.filter(v => v.check === 'false_edge')
  assert.equal(falseEdges.length, 9, `expected exactly nine false_edge violations, got ${JSON.stringify(falseEdges)}`)
  for (let i = 1; i <= 9; i++) {
    assert.ok(falseEdges.some(v => JSON.stringify(v).includes(`t-wf-${i}`) && JSON.stringify(v).includes('t-agent-definitions')),
      `expected a false_edge entry naming t-wf-${i} and t-agent-definitions`)
  }
  assert.equal(result.gate_required, true)
})

// ---- AC-8 ----

test('AC-8: a depends_on edge a criterion actually justifies is not a false edge', () => {
  const s = spec('spec-crossing', {
    touched: ['a/gen.js', 'b/consumer.js'],
    acceptance: [
      crit('AC-1', 'writes a/gen.js with the generated table'),
      crit('AC-2', 'reads a/gen.js to write b/consumer.js'),
    ],
  })
  const A_ = task('A', { owns: ['a/gen.js'], criteria: ['AC-1'] })
  const B_ = task('B', { owns: ['b/consumer.js'], deps: ['A'], criteria: ['AC-2'] })
  const result = loadGraphLint().lintGraph({ spec: s, graph: graph('spec-crossing', [A_, B_]), test_dir: 'substrate/test' })
  assert.equal(result.violations.filter(v => v.check === 'false_edge').length, 0)
})

// ---- AC-9 ----

test('AC-9: a depends_on naming an absent task id is an unknown_dependency violation', () => {
  const s = spec('spec-unknown-dep', { touched: ['a/x.js'], acceptance: [crit('AC-1', 'writes a/x.js')] })
  const g = graph('spec-unknown-dep', [task('t1', { owns: ['a/x.js'], deps: ['t-nope'], criteria: ['AC-1'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  const hits = result.violations.filter(v => v.check === 'unknown_dependency')
  assert.equal(hits.length, 1)
  const str = JSON.stringify(hits[0])
  assert.ok(str.includes('t1') && str.includes('t-nope'))
  assert.equal(result.gate_required, true)
})

// ---- AC-10 ----

test('AC-10: a mutual dependency cycle is a dependency_cycle violation even when each edge looks justified', () => {
  const s = spec('spec-cycle', {
    touched: ['a/x.js', 'b/y.js'],
    acceptance: [
      crit('AC-1', 'reads b/y.js to write a/x.js'),
      crit('AC-2', 'reads a/x.js to write b/y.js'),
    ],
  })
  const t1 = task('t1', { owns: ['a/x.js'], deps: ['t2'], criteria: ['AC-1'] })
  const t2 = task('t2', { owns: ['b/y.js'], deps: ['t1'], criteria: ['AC-2'] })
  const result = loadGraphLint().lintGraph({ spec: s, graph: graph('spec-cycle', [t1, t2]), test_dir: 'substrate/test' })

  const hits = result.violations.filter(v => v.check === 'dependency_cycle')
  assert.ok(hits.length >= 1, `expected a dependency_cycle violation, got ${JSON.stringify(result.violations)}`)
  const str = JSON.stringify(hits)
  assert.ok(str.includes('t1') && str.includes('t2'))
  assert.equal(result.gate_required, true)
})

test('AC-10: a task that depends on itself is a dependency_cycle violation', () => {
  const s = spec('spec-self-cycle', { touched: ['a/x.js'], acceptance: [crit('AC-1', 'writes a/x.js')] })
  const g = graph('spec-self-cycle', [task('t1', { owns: ['a/x.js'], deps: ['t1'], criteria: ['AC-1'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  const hits = result.violations.filter(v => v.check === 'dependency_cycle')
  assert.ok(hits.length >= 1, `expected a dependency_cycle violation, got ${JSON.stringify(result.violations)}`)
  assert.ok(JSON.stringify(hits).includes('t1'))
  assert.equal(result.gate_required, true)
})

// ---- AC-11 ----

test('AC-11: a depends_on edge whose dependent criteria name no decidable path warns, not violates', () => {
  const s = spec('spec-undecidable-edge', {
    touched: ['a/x.js', 'b/y.js'],
    acceptance: [
      crit('AC-1', 'writes a/x.js'),
      crit('AC-2', 'behaves sensibly under concurrent load'),
    ],
  })
  const t1 = task('t1', { owns: ['a/x.js'], criteria: ['AC-1'] })
  const t2 = task('t2', { owns: ['b/y.js'], deps: ['t1'], criteria: ['AC-2'] })
  const result = loadGraphLint().lintGraph({ spec: s, graph: graph('spec-undecidable-edge', [t1, t2]), test_dir: 'substrate/test' })

  assert.equal(result.violations.filter(v => v.check === 'false_edge').length, 0)
  assert.ok(result.warnings.some(w => JSON.stringify(w).includes('t2') && JSON.stringify(w).includes('t1')),
    'the undecidable edge must be recorded as a warning naming both tasks')
  assert.equal(result.gate_required, false)
})

// ---- AC-12 (k4 coverage fixture) ----

test('AC-12: orphaned criteria and duplicated assignments (k4 shape) are all reported, with AC-8 listing all ten tasks', () => {
  const acceptance = []
  for (let i = 1; i <= 16; i++) acceptance.push(crit(`AC-${i}`, `criterion ${i} names no repository path at all`))

  const tasks = []
  for (let i = 1; i <= 10; i++) {
    const rotating = `AC-${((i - 1) % 7) + 1}` // spreads AC-1..AC-7 duplicated across the ten tasks
    const extra = { 1: 'AC-9', 2: 'AC-10', 3: 'AC-13', 4: 'AC-14' }[i]
    const criteria = ['AC-8', rotating, ...(extra ? [extra] : [])] // AC-8 claimed by every one of the ten tasks
    tasks.push(task(`t${i}`, { owns: [`f${i}.js`], criteria }))
  }
  const s = spec('spec-k4-coverage', { touched: tasks.map((_, i) => `f${i + 1}.js`), acceptance })
  const result = loadGraphLint().lintGraph({ spec: s, graph: graph('spec-k4-coverage', tasks), test_dir: 'substrate/test' })

  const orphans = result.violations.filter(v => v.check === 'orphan_criterion')
  assert.equal(orphans.length, 4, `expected exactly 4 orphan_criterion violations, got ${JSON.stringify(orphans)}`)
  for (const id of ['AC-11', 'AC-12', 'AC-15', 'AC-16']) {
    assert.ok(orphans.some(o => JSON.stringify(o).includes(id)), `expected ${id} to be reported orphaned`)
  }

  const dups = result.violations.filter(v => v.check === 'duplicate_criterion')
  const ac8dup = dups.find(d => JSON.stringify(d).includes('"AC-8"') || JSON.stringify(d).includes('AC-8'))
  assert.ok(ac8dup, 'AC-8 must be reported as duplicated')
  const ac8str = JSON.stringify(ac8dup)
  for (let i = 1; i <= 10; i++) assert.ok(ac8str.includes(`t${i}`), `AC-8's duplicate entry must list t${i}`)

  assert.equal(result.gate_required, true)
})

// ---- AC-13 ----

test('AC-13: a clean single-task graph with every criterion claimed exactly once produces no violations', () => {
  const s = spec('spec-clean', {
    touched: ['a/x.js', 'a/y.js'],
    acceptance: [crit('AC-1', 'writes a/x.js'), crit('AC-2', 'writes a/y.js')],
  })
  const g = graph('spec-clean', [task('t1', { owns: ['a/x.js', 'a/y.js'], criteria: ['AC-1', 'AC-2'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  assert.deepEqual(result.violations, [])
  assert.equal(result.gate_required, false)
  assert.equal(result.violations.filter(v => v.check === 'orphan_criterion').length, 0)
  assert.equal(result.violations.filter(v => v.check === 'duplicate_criterion').length, 0)
})

// ---- AC-14 ----

test('AC-14: a task claiming a criterion id absent from Spec.acceptance is an unknown_criterion violation', () => {
  const s = spec('spec-unknown-crit', { touched: ['a/x.js'], acceptance: [crit('AC-1', 'writes a/x.js')] })
  const g = graph('spec-unknown-crit', [task('t1', { owns: ['a/x.js'], criteria: ['AC-1', 'AC-99'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  const hits = result.violations.filter(v => v.check === 'unknown_criterion')
  assert.equal(hits.length, 1)
  const str = JSON.stringify(hits[0])
  assert.ok(str.includes('t1') && str.includes('AC-99'))
})

// ---- AC-15 (k2i fixture) ----

test('AC-15: change-scoped criteria classify as panel, product-scoped as test, and classification alone never gates', () => {
  const acceptance = [
    crit('AC-1', 'every other field byte-identical to before'),
    crit('AC-2', 'the changed paths are exactly these three'),
    crit('AC-3', 'no dependency is added'),
    crit('AC-4', 'the test script is exactly `node --test substrate/test/*.test.js`'),
  ]
  const s = spec('spec-k2i', { touched: ['a/x.js'], acceptance })
  const g = graph('spec-k2i', [task('t1', { owns: ['a/x.js'], criteria: ['AC-1', 'AC-2', 'AC-3', 'AC-4'] })])
  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  assert.equal(result.criteria.length, 4, `expected one criteria entry per acceptance criterion, got ${JSON.stringify(result.criteria)}`)
  const byId = Object.fromEntries(result.criteria.map(c => [c.id, c]))
  assert.equal(byId['AC-1'].verification, 'panel')
  assert.equal(byId['AC-2'].verification, 'panel')
  assert.equal(byId['AC-3'].verification, 'panel')
  assert.equal(byId['AC-4'].verification, 'test')

  assert.match(JSON.stringify(byId['AC-1']), /byte-identical/i, 'the matched phrase must be recorded')
  assert.match(JSON.stringify(byId['AC-2']), /changed paths/i, 'the matched phrase must be recorded')
  assert.match(JSON.stringify(byId['AC-3']), /dependency is added/i, 'the matched phrase must be recorded')

  assert.equal(result.violations.length, 0, 'classification alone must never produce a violation')
  assert.equal(result.gate_required, false, 'classification alone must never set gate_required')
})

// ---- AC-16 ----

test('AC-16: a panel-classified criterion is still coverage-checked like any other — silent when claimed once, orphaned when claimed by none', () => {
  const panelCrit = crit('AC-1', 'every other field byte-identical to before')
  const other = crit('AC-2', 'writes a/x.js')

  const s1 = spec('spec-panel-claimed', { touched: ['a/x.js'], acceptance: [panelCrit, other] })
  const g1 = graph('spec-panel-claimed', [task('t1', { owns: ['a/x.js'], criteria: ['AC-1', 'AC-2'] })])
  const r1 = loadGraphLint().lintGraph({ spec: s1, graph: g1, test_dir: 'substrate/test' })
  assert.ok(!r1.violations.some(v => JSON.stringify(v).includes('AC-1')),
    'classification must never manufacture a violation for a criterion that is properly claimed')

  const s2 = spec('spec-panel-orphan', { touched: ['a/x.js'], acceptance: [panelCrit, other] })
  const g2 = graph('spec-panel-orphan', [task('t1', { owns: ['a/x.js'], criteria: ['AC-2'] })])
  const r2 = loadGraphLint().lintGraph({ spec: s2, graph: g2, test_dir: 'substrate/test' })
  const orphans = r2.violations.filter(v => v.check === 'orphan_criterion')
  assert.ok(orphans.some(o => JSON.stringify(o).includes('AC-1')),
    'classification must never exempt an unclaimed criterion from orphan_criterion')
})

// ---- AC-17 ----

test('AC-17: a touched_surfaces entry under test_dir (k1i shape) is a spec_names_test_surface violation; a sibling dir is not', () => {
  const lint = loadGraphLint()

  const sBad = spec('spec-k1i', {
    touched: ['substrate/test/ci-workflow.test.js', 'a/x.js'],
    acceptance: [crit('AC-1', 'writes a/x.js')],
  })
  const gBad = graph('spec-k1i', [task('t1', { owns: ['a/x.js', 'substrate/test/ci-workflow.test.js'], criteria: ['AC-1'] })])
  const rBad = lint.lintGraph({ spec: sBad, graph: gBad, test_dir: 'substrate/test' })
  const hits = rBad.violations.filter(v => v.check === 'spec_names_test_surface')
  assert.equal(hits.length, 1, `expected exactly one spec_names_test_surface violation, got ${JSON.stringify(rBad.violations)}`)
  assert.ok(JSON.stringify(hits[0]).includes('substrate/test/ci-workflow.test.js'))
  assert.equal(rBad.gate_required, true)

  const sOk = spec('spec-sibling-dir', {
    touched: ['substrate/testing/x.js', 'a/y.js'],
    acceptance: [crit('AC-1', 'writes a/y.js')],
  })
  const gOk = graph('spec-sibling-dir', [task('t1', { owns: ['a/y.js', 'substrate/testing/x.js'], criteria: ['AC-1'] })])
  const rOk = lint.lintGraph({ spec: sOk, graph: gOk, test_dir: 'substrate/test' })
  assert.equal(rOk.violations.filter(v => v.check === 'spec_names_test_surface').length, 0,
    "'substrate/test' (non-directory-shaped) must never cover 'substrate/testing/x.js'")
})

// ---- AC-18 ----

test('AC-18: build-spec.js documents the optional test_dir arg and defaults it to `${A.repo}/test`, as build-implement.js does', () => {
  const text = readWorkflowText()
  const argsBlockEnd = text.indexOf('const A = args')
  assert.ok(argsBlockEnd > 0, 'expected the top-of-file args comment block, ending before `const A = args`')
  const argsBlock = text.slice(0, argsBlockEnd)
  assert.match(argsBlock, /test_dir/, 'the args comment block must document the new optional test_dir argument')

  assert.match(text, /test_dir\s*\?\?/, 'test_dir must be read with a nullish-coalescing default, as build-implement.js does')
  const idx = text.search(/test_dir\s*\?\?/)
  const nearby = text.slice(idx, idx + 150)
  assert.match(nearby, /repo/, 'the default must derive from A.repo')
  assert.match(nearby, /test/, 'the default must resolve to a "test" directory under the repo')
})

// ---- AC-19 ----

test('AC-19: lintGraph never mutates the spec or graph it is given, even on a fixture that produces violations', () => {
  const s = spec('spec-immutable', {
    touched: ['.claude/workflows/build-implement.js', 'substrate/x.js'],
    acceptance: [crit('AC-1', 'updates .claude/workflows/build-implement.js')],
  })
  const g = graph('spec-immutable', [task('t-x', { owns: ['substrate/x.js'], criteria: ['AC-1'] })])
  const sBefore = structuredClone(s)
  const gBefore = structuredClone(g)

  const result = loadGraphLint().lintGraph({ spec: s, graph: g, test_dir: 'substrate/test' })

  assert.ok(result.violations.length > 0, 'this fixture must actually produce a violation to make the immutability check meaningful')
  assert.deepEqual(s, sBefore, 'lintGraph must not mutate the Spec it is given')
  assert.deepEqual(g, gBefore, 'lintGraph must not mutate the TaskGraph it is given')
})

// ---- AC-20 / AC-21 (workflow wiring — static, since the runtime that executes phase()/agent()/parallel() is unavailable here) ----

function specPhaseText(text) {
  const start = text.indexOf("phase('Spec')")
  assert.ok(start >= 0, "expected a phase('Spec') marker in build-spec.js")
  return text.slice(start)
}

// Loose proximity check: does `log(` appear referencing `marker` (or shortly after it), i.e. is the
// collection actually emitted through the run trace rather than only computed and stored silently.
function nearLog(text, marker) {
  const idx = text.indexOf(marker)
  if (idx === -1) return false
  const window = text.slice(idx, idx + 400)
  return /log\(/.test(window)
}

test('AC-20: a lint violation gates the spec and stamps a `lint` object with script-stamped provenance', () => {
  const text = readWorkflowText()
  const body = specPhaseText(text)

  assert.match(body, /lintGraph\s*\(/, 'the Spec phase must call lintGraph after Router ∥ Decomposer resolve')
  assert.match(body, /lint\s*:/, 'the returned per-item entry must carry a `lint` key')
  assert.match(body, /graph lint:\s*/, 'each lint violation must add a risk_reasons entry prefixed "graph lint: "')
  assert.match(body, /gate_required/, 'the gate decision must consult lint.gate_required, forcing pending even when risk said low')
  assert.match(body, /['"`]graph_lint['"`]/, "the lint provenance must be stamped node: 'graph_lint'")
  assert.match(body, /\brun_id\b/, 'lint provenance must carry the run_id (CLAUDE.md rule 10)')
  assert.match(body, /\bcreated_at\b/, 'lint provenance must carry created_at (CLAUDE.md rule 10)')
})

test('AC-21: a warnings-only lint result stays ready, still carries a `lint` object, and every finding reaches log()', () => {
  const text = readWorkflowText()
  const body = specPhaseText(text)

  assert.match(body, /lint\.violations/, 'the Spec phase must reference lint.violations')
  assert.match(body, /lint\.warnings/, 'the Spec phase must reference lint.warnings')
  assert.ok(nearLog(body, 'lint.violations'), 'each lint violation must be emitted through log() so it is visible in the run trace')
  assert.ok(nearLog(body, 'lint.warnings'), 'each lint warning must be emitted through log() so it is visible in the run trace')
  assert.match(body, /not_required/, 'an item whose only lint findings are warnings must still resolve to gate "not_required"')
})
