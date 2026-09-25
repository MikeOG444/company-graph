export const meta = {
  name: 'build-spec',
  description: 'Plan an iteration, write specs, classify risk and decompose in parallel. Ends at the Spec Gate: high-risk specs need a human decision before /build-implement.',
  phases: [{ title: 'Plan', detail: 'select work items within capacity — script code, zero tokens' }, { title: 'Spec', detail: 'spec → (risk router ∥ decomposer) per item' }],
}

// args: { repo, workItems: WorkItem[], capacity: { tokens, iteration }, run_id, now, project_context?, test_dir?,
//         agent_types?: false, missing_agent_types?: [name] }
//   project_context: one sentence about the venture the router should know (e.g. "client: self, no external consumers yet").
//   repo: a directory of THIS git repository (e.g. "toy"); surfaces are repo-relative paths (toy/src/app.js).
//   test_dir: where TestSets land, relative to the worktree root (default "${repo}/test", matching
//             build-implement.js's test_dir semantics). Used only by graph-lint's test-dir-surfaces check
//             (B3, folding in A6): a spec that names a path under test_dir in touched_surfaces hands the
//             Test Author's job to the implementer, so it gates the spec for a human at the Spec Gate.
//   agent_types: false drops every agentType binding (a session that predates .claude/agents/ registering at all).
//   missing_agent_types: names the agentTypes THIS run's runtime has not yet registered (committing one is necessary
//             but not sufficient — the runtime rescans on its own schedule); AT() drops only those, not every type,
//             so every constraint that matters is also stated inline in the prompts below and survives the drop.
// returns: { ready: [{spec, graph, lint}], gated: [{spec, graph, lint}], provenance }
//
// The human reviews `gated` in chat, then runs:
//   /build-implement with approved specs + the `ready` list

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const MISSING = new Set(A.missing_agent_types ?? [])
const AT = (t) => (A.agent_types === false || MISSING.has(t) ? {} : { agentType: t })
// Where TestSets land, relative to the worktree root — build-implement.js's `test_dir` semantics and default.
// Read once here, not per work item: it is a property of the run, not of the item being specced.
const TEST_DIR = A.test_dir ?? `${A.repo}/test`
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
// Risk Router, code half: these are high by rule, no judgment needed. The agent half judges only what the rule cannot see.
// Rubric (OPERATING_MODEL §2.1): auth, data schema, payments, infra, or anything irreversible. Surface kinds schema and infra
// are high outright; config and any other kind only when the ref names a sensitive term. Free text is never matched: an r4 goal
// tripped a keyword regex on an unrelated word, and a read-only package.json labelled `config` tripped the kind check.
const HIGH_KINDS = new Set(['schema', 'infra'])
const HIGH_REF = /\bauth|authz|authn|token|secret|credential|password|payment|billing|migrat/i
const codeRisk = (spec) => {
  const reasons = []
  for (const s of spec.touched_surfaces ?? []) {
    if (HIGH_KINDS.has(s.kind)) reasons.push(`surface kind ${s.kind}: ${s.ref}`)
    else if (HIGH_REF.test(s.ref)) reasons.push(`surface ref names a sensitive term: ${s.ref}`)
  }
  return reasons
}

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const Surface = { type: 'object', additionalProperties: false, required: ['kind', 'ref'],
  properties: { kind: { enum: ['path', 'module', 'api', 'schema', 'config', 'infra'] }, ref: { type: 'string' } } }
const Criterion = { type: 'object', additionalProperties: false, required: ['id', 'given', 'when', 'then', 'testable'],
  properties: { id: { type: 'string' }, given: { type: 'string' }, when: { type: 'string' }, then: { type: 'string' }, testable: { type: 'boolean' } } }
const Spec = { type: 'object', additionalProperties: false,
  required: ['id', 'work_item_id', 'goal', 'acceptance', 'touched_surfaces', 'out_of_scope'],
  properties: { id: { type: 'string' }, work_item_id: { type: 'string' }, goal: { type: 'string' },
    acceptance: { type: 'array', minItems: 1, items: Criterion },
    touched_surfaces: { type: 'array', items: Surface },
    out_of_scope: { type: 'array', items: { type: 'string' } } } }
const Risk = { type: 'object', additionalProperties: false, required: ['risk', 'reasons'],
  properties: { risk: { enum: ['low', 'high'] }, reasons: { type: 'array', items: { type: 'string' } } } }
const Task = { type: 'object', additionalProperties: false,
  required: ['id', 'spec_id', 'description', 'owned_surfaces', 'depends_on', 'criteria_ids'],
  properties: { id: { type: 'string' }, spec_id: { type: 'string' }, description: { type: 'string' },
    owned_surfaces: { type: 'array', minItems: 1, items: Surface },
    depends_on: { type: 'array', items: { type: 'string' } },
    criteria_ids: { type: 'array', items: { type: 'string' } } } }
const TaskGraph = { type: 'object', additionalProperties: false, required: ['spec_id', 'tasks'],
  properties: { spec_id: { type: 'string' }, tasks: { type: 'array', minItems: 1, items: Task } } }

// ---- BEGIN plan-selection ----
// The Iteration Planner, in code (CLAUDE.md rule 3: selecting, counting and filtering are script code).
//
// This was a cheap-model agent until run k1. Its whole contract was to return the ids it selected, but a
// WorkItem.intent reads like an instruction, and the agent carried the default workflow-subagent toolset —
// Bash, Write, Edit — because the call site named no agentType. So it created .github/workflows/ci.yml,
// ran both suites, `git commit`ed the result, and THEN returned the correct {ids} as if it had only chosen.
// The schema was satisfied and the run looked clean; the commit was found by a git hook, not by the line.
// One cheap agent had bypassed Spec, TestSet, the Verifier Panel and the owned-surfaces boundary check.
//
// No judgment crosses this edge. Fitting items into a token budget is a sort and a take, so nothing is
// gained by asking a model and a whole class of failure is removed by not asking one. Deterministic, free,
// and replayable, which the agent never was.
//
// Order: starved items first (deferred_iterations desc), then priority (1 = highest), then id for stability.
// An item with no budget.tokens is costed at defaultItemTokens. A missing or non-positive capacity means
// "no ceiling" — take everything — rather than silently selecting nothing.
function planIteration(workItems, capacityTokens, defaultItemTokens = 120000) {
  const items = [...(workItems ?? [])]
  items.sort((a, b) =>
    (b.deferred_iterations ?? 0) - (a.deferred_iterations ?? 0) ||
    (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) ||
    String(a.id ?? '').localeCompare(String(b.id ?? '')))
  const cap = Number(capacityTokens)
  const bounded = Number.isFinite(cap) && cap > 0
  const selected = []
  const skipped = []
  let planned_tokens = 0
  for (const w of items) {
    const cost = Number(w?.budget?.tokens ?? defaultItemTokens)
    if (bounded && planned_tokens + cost > cap) { skipped.push({ id: w?.id, cost, reason: 'over_capacity' }); continue }
    planned_tokens += cost
    selected.push(w)
  }
  return { selected, skipped, planned_tokens }
}
// ---- END plan-selection ----

// ---- BEGIN graph-lint ----
// The decomposition rules stated in the Decomposer prompt above (and nowhere validated) as pure, zero-token
// script code (CLAUDE.md rule 3). Called once per work item, after Router ∥ Decomposer and before the spec
// is stamped, on the Spec and TaskGraph the agents returned. Five checks:
//   1. criterion reachability — every path a task's claimed criteria name must sit inside that task's owned_surfaces.
//   2. false edges — every depends_on must be justified by a variable actually crossing it (plus unknown deps
//      and dependency cycles, which are never justifiable).
//   3. criterion coverage — every Spec criterion claimed by exactly one task; an unknown criteria_ids entry is
//      reported too.
//   4. change-scoped classification — every criterion is classified 'panel' (assertable only against a diff,
//      never after merge) or 'test' (product-scoped), carried for a later consumer; classification alone never
//      creates or erases a coverage gap.
//   5. test-dir surfaces (A6, folded in) — a Spec must never name a path under the repo's test_dir in its own
//      touched_surfaces; that is the Test Author's surface, not the Spec's to claim.
// On violation: this NEVER drops, repairs, re-decomposes or fails the run. It only reports — the caller (the
// Spec phase below) decides what a violation means for the gate. Where a rule cannot be decided from the data
// (a criterion whose text names no path; a dependency whose crossing cannot be determined), a WARNING is
// recorded and the item passes: a false positive here stops legitimate work, a false negative only leaves
// today's behaviour. No `args`, `A`, `log`, `agent` or any runtime binding is referenced anywhere below this
// line down to END graph-lint — every function here is a pure function of its plain-object arguments, callable
// standalone (substrate/test/extract-fixloop.js idiom: whole-line sentinels + `new Function`).

// Canonical form of a Surface ref: drop a '#...' fragment (a schema pointer), a leading './', and a trailing
// '/'. Copied verbatim from build-implement.js's surfaceRef (kept in sync by hand, same as the inlined
// contracts above — the runtime forbids importing across workflow files).
function surfaceRef(surface) {
  let ref = String(surface?.ref ?? '')
  const hashIdx = ref.indexOf('#')
  if (hashIdx !== -1) ref = ref.slice(0, hashIdx)
  if (ref.startsWith('./')) ref = ref.slice(2)
  if (ref.length > 1 && ref.endsWith('/')) ref = ref.slice(0, -1)
  return ref
}

// True when touchedRef sits inside one of ownedRefs or exemptPrefixes. An owned/exempt ref ending in '/' is
// directory-shaped: it covers itself and everything under it. One that does NOT end in '/' covers only an
// exact match — 'substrate/test' never covers 'substrate/testing/x.js'. Copied verbatim from
// build-implement.js's withinOwned.
function withinOwned(touchedRef, ownedRefs, exemptPrefixes) {
  const t = surfaceRef({ ref: touchedRef })
  const covers = (rawRef) => {
    let owned = String(rawRef ?? '')
    const hashIdx = owned.indexOf('#')
    if (hashIdx !== -1) owned = owned.slice(0, hashIdx)
    if (owned.startsWith('./')) owned = owned.slice(2)
    if (t === owned) return true
    if (owned.endsWith('/')) {
      const dir = owned.slice(0, -1)
      if (t === dir || t.startsWith(owned)) return true
    }
    return false
  }
  return (ownedRefs ?? []).some(covers) || (exemptPrefixes ?? []).some(covers)
}

// Repository-relative paths named in a criterion's given/when/then text, deduped and normalized through
// surfaceRef. Two shapes are recognized: a multi-segment path containing at least one '/' (so a sibling-prefix
// near miss like 'substrate/testing' is never split into a bogus path), and a bare filename carrying a
// recognized extension (e.g. 'contracts.schema.json', 'package.json') for the top-level files that name no
// directory at all. Anything else — prose, a version number, a bare word — is not a path: criterionPaths
// returns [] for it, which callers below treat as "undecidable", never as "no violation is possible here".
function criterionPaths(criterion) {
  const text = [criterion?.given, criterion?.when, criterion?.then].filter(Boolean).join('\n')
  const PATH_RE = /\.{0,2}\/?(?:[A-Za-z0-9_.\-]+\/)+[A-Za-z0-9_.\-]*|\b[A-Za-z0-9_.\-]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|md|yml|yaml|py|go|rb|css|html)\b/g
  const found = []
  const seen = new Set()
  // matchAll, never a stateful `.exec` loop: the block must stay free of anything a static reader can
  // mistake for a shell call, and a /g regex driven by lastIndex is the one shape that can silently skip.
  for (const m of text.matchAll(PATH_RE)) {
    let raw = m[0].replace(/^[`"'(\[]+/, '').replace(/[`"')\],.;:]+$/, '')
    if (!raw || /^\.+$/.test(raw)) continue
    const norm = surfaceRef({ ref: raw })
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    found.push(norm)
  }
  return found
}

// A criterion is 'panel' (change-scoped: an assertion about THIS diff — "to before", "byte-identical", the
// changed paths, a dependency added/removed/upgraded — that no test landed after the merge can ever assert,
// because after the merge there is no "before" and no "this change" left to compare against) or 'test'
// (product-scoped: true of the shipped product on every future run, and assertable by a landed test). The
// matched phrase travels with a panel classification so a later consumer (the correctness lens) can be told
// which criteria it may demand tests for. Classification alone never exempts a criterion from coverage.
// `matched` carries the phrase AS IT APPEARS IN THE CRITERION, not a canned tag for the pattern that fired:
// the consumer has to be able to point at the words. "no dependency is added" must come back as
// "dependency is added", so the added/removed/upgraded pattern pulls in the noun in front of the verb.
const PANEL_PATTERNS = [
  /\bbyte[- ]identical\b/i,
  /\bto before\b/i,
  /\bchanged paths?\b/i,
  /\b(?:\w+\s+)?(?:is|are)\s+(?:added|removed|upgraded)\b/i,
  /\bunmodified\b/i,
  /\bunchanged\b/i,
]
function classifyCriterion(criterion) {
  const text = [criterion?.given, criterion?.when, criterion?.then].filter(Boolean).join('\n')
  for (const re of PANEL_PATTERNS) {
    const hit = text.match(re)
    if (hit) return { verification: 'panel', matched: hit[0] }
  }
  return { verification: 'test' }
}

// CHECK 1 — every path a task's claimed criteria name must sit inside that task's owned_surfaces. A path is
// only checked against ownership once it is confirmed to be a real surface of this Spec (present in
// Spec.touched_surfaces, directory-aware); a path a criterion names that touches nothing the Spec declared is
// undecidable prose, not a reachability defect, so it warns rather than violates.
function checkCriterionReachability({ spec, graph }) {
  const violations = []
  const warnings = []
  const touchedRefs = (spec?.touched_surfaces ?? []).map(s => s.ref)
  for (const task of graph?.tasks ?? []) {
    const ownedRefs = (task?.owned_surfaces ?? []).map(s => s.ref)
    for (const cid of task?.criteria_ids ?? []) {
      const criterion = (spec?.acceptance ?? []).find(c => c.id === cid)
      if (!criterion) continue // an id absent from the Spec is checkCriterionCoverage's unknown_criterion, not this check's concern
      const paths = criterionPaths(criterion)
      if (!paths.length) {
        warnings.push({ check: 'criterion_reachability', reason: 'names_no_path', task: task.id, criterion: cid })
        continue
      }
      for (const path of paths) {
        if (!withinOwned(path, touchedRefs, [])) {
          warnings.push({ check: 'criterion_reachability', reason: 'path_not_in_touched_surfaces', task: task.id, criterion: cid, path })
          continue
        }
        if (!withinOwned(path, ownedRefs, [])) {
          violations.push({ check: 'criterion_reachability', task: task.id, criterion: cid, path })
        }
      }
    }
  }
  return { violations, warnings }
}

// Every task id depends_on names, restricted to ids that actually exist in this graph — a dependency-cycle
// search never needs to (and must not) walk into an unknown_dependency violation. Returns one entry per
// distinct cycle (task ids deduped and in walk order), including a task depending on itself.
function findDependencyCycles(tasks) {
  const byId = new Map((tasks ?? []).filter(t => t?.id != null).map(t => [t.id, t]))
  const cycles = []
  const cycleKeys = new Set()
  const visited = new Set()
  const stack = []
  const onStack = new Set()
  const visit = (id) => {
    if (onStack.has(id)) {
      const start = stack.indexOf(id)
      const cyc = [...new Set(stack.slice(start).concat(id))]
      const key = [...cyc].sort().join(',')
      if (!cycleKeys.has(key)) { cycleKeys.add(key); cycles.push(cyc) }
      return
    }
    if (visited.has(id)) return
    visited.add(id)
    stack.push(id)
    onStack.add(id)
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (byId.has(dep)) visit(dep)
    }
    stack.pop()
    onStack.delete(id)
  }
  for (const t of tasks ?? []) if (t?.id != null) visit(t.id)
  return cycles
}

// CHECK 2 — every depends_on must be justified by a variable actually crossing it: the depended-on task's
// owned_surfaces must cover a path the DEPENDENT task's criteria name (that is what the dependent task would
// be reading from the one it depends on). depends_on naming an absent task id is rejected outright, and so is
// any dependency cycle, self-loop included — "B comes after A" is never itself a reason (CLAUDE.md rule 1).
function checkFalseEdges({ spec, graph }) {
  const violations = []
  const warnings = []
  const tasks = graph?.tasks ?? []
  const byId = new Map(tasks.filter(t => t?.id != null).map(t => [t.id, t]))
  for (const task of tasks) {
    for (const depId of task?.depends_on ?? []) {
      const dep = byId.get(depId)
      if (!dep) {
        violations.push({ check: 'unknown_dependency', task: task.id, depends_on: depId })
        continue
      }
      const depOwnedRefs = (dep.owned_surfaces ?? []).map(s => s.ref)
      let decidable = false
      let justified = false
      for (const cid of task?.criteria_ids ?? []) {
        const criterion = (spec?.acceptance ?? []).find(c => c.id === cid)
        if (!criterion) continue
        for (const path of criterionPaths(criterion)) {
          decidable = true
          if (withinOwned(path, depOwnedRefs, [])) { justified = true; break }
        }
        if (justified) break
      }
      if (!decidable) {
        warnings.push({ check: 'false_edge', reason: 'edge_undecidable', task: task.id, depends_on: depId })
      } else if (!justified) {
        violations.push({ check: 'false_edge', task: task.id, depends_on: depId })
      }
    }
  }
  for (const cyc of findDependencyCycles(tasks)) {
    violations.push({ check: 'dependency_cycle', tasks: cyc })
  }
  return { violations, warnings }
}

// CHECK 3 — every criterion in Spec.acceptance claimed by exactly one task. Zero claimants is an orphan; more
// than one is a duplicate, reported with every claiming task id (AC-8 claimed by all ten tasks lists all ten).
// A task's criteria_ids entry absent from Spec.acceptance is reported too, against the claiming task.
function checkCriterionCoverage({ spec, graph }) {
  const violations = []
  const claimants = new Map()
  for (const task of graph?.tasks ?? []) {
    for (const cid of task?.criteria_ids ?? []) {
      if (!claimants.has(cid)) claimants.set(cid, [])
      claimants.get(cid).push(task.id)
    }
  }
  for (const c of spec?.acceptance ?? []) {
    const claimedBy = claimants.get(c.id) ?? []
    if (claimedBy.length === 0) violations.push({ check: 'orphan_criterion', criterion: c.id })
    else if (claimedBy.length > 1) violations.push({ check: 'duplicate_criterion', criterion: c.id, tasks: claimedBy })
  }
  const acceptanceIds = new Set((spec?.acceptance ?? []).map(c => c.id))
  for (const [cid, claimingTasks] of claimants) {
    if (!acceptanceIds.has(cid)) {
      for (const taskId of claimingTasks) violations.push({ check: 'unknown_criterion', task: taskId, criterion: cid })
    }
  }
  return { violations }
}

// CHECK 5 (A6, folded in) — a surface under the repo's test_dir must never appear in Spec.touched_surfaces:
// that hands the Test Author's job to the implementer, and the TestSet the Test Author would have produced
// lands nowhere. test_dir is always treated as directory-shaped here (a trailing '/' is added if missing) so
// a file under it is covered, while a same-prefix sibling directory ('substrate/testing/') never is.
function checkTestSurfaces({ spec, test_dir }) {
  const violations = []
  const dir = String(test_dir ?? '')
  const dirRef = dir.endsWith('/') ? dir : `${dir}/`
  for (const surf of spec?.touched_surfaces ?? []) {
    const ref = surfaceRef(surf)
    if (withinOwned(ref, [dirRef], [])) {
      violations.push({ check: 'spec_names_test_surface', ref })
    }
  }
  return { violations }
}

// The whole lint, read-only over spec and graph (never mutated, never re-decomposed, never repaired). Callers
// decide what a violation means for the gate; this only reports. gate_required is true iff violations is
// non-empty — warnings never gate on their own.
function lintGraph({ spec, graph, test_dir }) {
  const reach = checkCriterionReachability({ spec, graph })
  const edges = checkFalseEdges({ spec, graph })
  const coverage = checkCriterionCoverage({ spec, graph })
  const testSurfaces = checkTestSurfaces({ spec, test_dir })
  const violations = [...reach.violations, ...edges.violations, ...coverage.violations, ...testSurfaces.violations]
  const warnings = [...reach.warnings, ...edges.warnings]
  const criteria = (spec?.acceptance ?? []).map(c => ({ id: c.id, ...classifyCriterion(c) }))
  return { violations, warnings, criteria, gate_required: violations.length > 0 }
}
// ---- END graph-lint ----

// =====================================================================
phase('Plan')
const { selected, skipped, planned_tokens } = planIteration(A.workItems, A.capacity?.tokens)
log(`Planned ${selected.length}/${(A.workItems ?? []).length} work items, ${planned_tokens} budgeted tokens`)
// No silent caps: every item left out says so and why.
for (const s of skipped) log(`deferred ${s.id}: ${s.reason} (${s.cost} tokens vs ${A.capacity?.tokens} capacity)`)

// =====================================================================
phase('Spec')
// One pipeline per work item. Inside each: Spec → (Router ∥ Decomposer). No barrier across items.
const specced = (await pipeline(selected, async (w) => {
  const spec = await agent(
    `Write a Spec for this work item for the app at ./${A.repo}/ (a directory of this git repository). Read its code and tests as needed.
     YOU ARE SPECIFYING THE WORK, NOT DOING IT. A WorkItem.intent is written as an instruction, but it is your INPUT to
     describe, never a task to carry out. Do not create, edit or delete any file, and do not run git add, git commit or any
     other command that changes the repository. Read freely; write nothing. Producing the change instead of the Spec skips
     the Test Author, the Verifier Panel and the owned-surfaces boundary check, and leaves the implementer an empty diff.
     Surface refs are repository-relative paths (e.g. ${A.repo}/src/app.js).
     Acceptance criteria must be testable Given/When/Then. List every touched surface and what is out of scope.
     Work item: ${JSON.stringify(w)}`,
    { label: `spec:${w.id}`, model: MODEL.strong, ...AT('spec'), schema: Spec })
  if (!spec) return null

  // Router and Decomposer both consume only the Spec — run together.
  const [risk, graph] = await parallel([
    () => agent(`Classify blast radius of this spec as low or high, with reasons. Do not create, edit or delete any file, and do
                 not run any command that changes the repository — you classify only. ${A.project_context ? `Project context: ${A.project_context}. ` : ''}
                 High ONLY if it changes the stored data shape, touches auth/secrets/payments/infra, is irreversible, or BREAKS an existing
                 route's contract for existing clients (an additive route, field, or query parameter is low). Spec: ${JSON.stringify(spec)}`,
      { label: `route:${w.id}`, model: MODEL.cheap, ...AT('route'), schema: Risk }),
    () => agent(`Decompose this spec into IMPLEMENTATION tasks with DISJOINT owned surfaces (no two tasks may own the same path).
                 Do not create, edit or delete any file, and do not run any command that changes the repository — you plan the split only.
                 Never create a task whose only job is writing tests or documentation. A separate Test Author writes tests from the
                 spec, so criteria about existing tests passing or npm test exiting 0 belong to the implementation task that touches
                 the code. A DOCUMENTATION criterion resolves the same way: it belongs to the implementation task that owns the code
                 it documents, and that task's owned_surfaces MUST then include the doc file so the implementer can legally write it.
                 A doc file given a task of its own has no code to verify against, and the lenses end up arguing over which task owes
                 the criterion: run t2i escalated at max_rounds doing exactly that with a README criterion split off from the handler
                 it described, at a cost of $4.38.
                 Prefer ONE task; split only when two disjoint code surfaces can be built independently. Add depends_on only where one
                 task must read another's output. Every criterion must be covered by some task, AND every surface a task's criteria
                 require it to write must appear in that task's owned_surfaces — a criterion assigned to a task that may not touch the
                 file it names is unsatisfiable, and the fix loop cannot close it (rulings r5, c1).
                 App at ./${A.repo}/ in this repository. Spec: ${JSON.stringify(spec)}`,
      { label: `decompose:${w.id}`, model: MODEL.cheap, ...AT('decompose'), schema: TaskGraph }),
  ])
  if (!risk || !graph) return null

  const ruleReasons = codeRisk(spec)
  const ruleHigh = ruleReasons.length > 0 || risk.risk === 'high'
  if (ruleReasons.length) log(`${w.id}: high by rule (${ruleReasons[0]})`)

  // Graph lint: the decomposition rules stated in the Decomposer prompt above, checked in code (CLAUDE.md
  // rule 3), zero tokens. Never repairs, re-decomposes or fails the run — it only reports, and a violation
  // gates the spec for a human even when the router said low.
  const lint = lintGraph({ spec, graph, test_dir: TEST_DIR })
  for (const v of lint.violations) log(`${w.id}: graph lint violation [${v.check}] ${JSON.stringify(v)}`)
  for (const wn of lint.warnings) log(`${w.id}: graph lint warning [${wn.check}] ${JSON.stringify(wn)}`)
  const lintReasons = lint.violations.map(v => `graph lint: ${v.check} ${JSON.stringify(v)}`)
  const gatePending = ruleHigh || lint.gate_required

  return {
    spec: { ...spec, risk: ruleHigh ? 'high' : 'low',
            risk_reasons: [...ruleReasons.map(r => `rule: ${r}`), ...risk.reasons, ...lintReasons],
            gate: gatePending ? 'pending' : 'not_required',
            provenance: stamp('spec_writer', MODEL.strong, 'hotl') },
    graph: { ...graph, provenance: stamp('decomposer', MODEL.cheap, 'dark_factory') },
    // Script-stamped provenance (CLAUDE.md rule 10), spelled out rather than routed through stamp():
    // graph_lint is pure script code — no agent, no model, no tokens — and its run_id/created_at come
    // from args, never from a clock inside the workflow (rule 9).
    lint: { violations: lint.violations, warnings: lint.warnings, criteria: lint.criteria, gate_required: lint.gate_required,
            provenance: { node: 'graph_lint', executor: 'ai_agent', method: 'hotl', model: 'n/a',
                          run_id: A.run_id, created_at: A.now } },
  }
})).filter(Boolean)

// Edge, not agent: split at the gate.
const ready = specced.filter(s => s.spec.gate === 'not_required')
const gated = specced.filter(s => s.spec.gate === 'pending')
log(`${ready.length} low-risk specs ready; ${gated.length} high-risk specs await Spec Gate`)

return { ready, gated, provenance: stamp('build-spec', 'n/a', 'hotl') }
