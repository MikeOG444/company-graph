export const meta = {
  name: 'build-implement',
  description: 'Implement approved specs: implementer and test author in parallel per task, adversarial verifier panel, converging fix loop, one integration barrier, evidence bundle out.',
  phases: [{ title: 'Implement+Verify', detail: 'per task: implementer ∥ test author → panel → fix loop' }, { title: 'Integrate', detail: 'the one barrier' }, { title: 'Evidence', detail: 'assembled by code' }],
}

// args: { repo, project_id, iteration, specs: [{spec, graph}], run_id, now,
//         budget?: { task_tokens }, k_rounds?, artifact_dir?, base?,
//         canary?: { task_id? | spec_id?, mutation: string }, test_hint?: string, run_hint?: string }
//   repo: a directory of THIS git repository (e.g. "toy"). Worktrees are of the repository at base (default HEAD),
//         one branch per task (task/<task_id>); the app is at <worktree>/<repo>/.
//   canary: a deliberate defect injected into one task's change set before verification (OPERATING_MODEL §2.4.4).
// returns: EvidenceBundle (see contracts.schema.json)
//
// Human touchpoints: none inside this run. Escalations come back in the bundle;
// the human handles them in chat and re-runs for the affected specs.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const K_ROUNDS = A.k_rounds ?? 3
const TASK_TOKENS = A.budget?.task_tokens ?? 250000
const ART = A.artifact_dir ?? '.artifacts'
const BASE = A.base ?? 'HEAD'
// .claude/agents/ definitions register at session start; a session that predates them must pass agent_types:false
// (an unknown agentType throws and drops the task).
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const APP = `${A.repo}`
const VETO_LENS = 'security'
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
// Output tokens for this turn's shared pool at start; the runtime exposes no per-agent count, so spend is a run-level delta.
const TOKENS_AT_START = budget.spent()

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const Surface = { type: 'object', additionalProperties: false, required: ['kind', 'ref'],
  properties: { kind: { enum: ['path', 'module', 'api', 'schema', 'config', 'infra'] }, ref: { type: 'string' } } }
const ChangeSet = { type: 'object', additionalProperties: false,
  required: ['id', 'task_id', 'spec_id', 'worktree', 'base_commit', 'diff_ref', 'touched_surfaces', 'revision'],
  properties: { id: { type: 'string' }, task_id: { type: 'string' }, spec_id: { type: 'string' },
    worktree: { type: 'string' }, base_commit: { type: 'string' }, diff_ref: { type: 'string' },
    touched_surfaces: { type: 'array', items: Surface }, notes: { type: 'string' }, revision: { type: 'integer' } } }
const TestSet = { type: 'object', additionalProperties: false, required: ['id', 'task_id', 'tests_ref', 'criteria_coverage'],
  properties: { id: { type: 'string' }, task_id: { type: 'string' }, tests_ref: { type: 'string' },
    criteria_coverage: { type: 'array', items: { type: 'string' } } } }
const TestResults = { type: 'object', additionalProperties: false, required: ['passed', 'failed', 'results_ref', 'criteria_covered'],
  properties: { passed: { type: 'integer' }, failed: { type: 'integer' }, results_ref: { type: 'string' },
    criteria_covered: { type: 'array', items: { type: 'string' } } } }
const Finding = { type: 'object', additionalProperties: false,
  required: ['id', 'lens', 'severity', 'location', 'claim', 'evidence', 'dedupe_key', 'status'],
  properties: { id: { type: 'string' }, lens: { type: 'string' }, severity: { enum: ['high', 'medium', 'low'] },
    location: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' }, dedupe_key: { type: 'string' },
    status: { enum: ['open', 'fixed', 'disputed', 'overruled', 'repeat'] } } }
const Verdict = { type: 'object', additionalProperties: false,
  required: ['lens', 'verdict', 'attempts', 'findings', 'confidence'],
  properties: { lens: { enum: ['spec_conformance', 'correctness', 'security', 'tiebreak'] },
    verdict: { enum: ['pass', 'fail'] },
    attempts: { type: 'array', minItems: 3, items: { type: 'string' } },   // laziness guard: enforced by schema
    findings: { type: 'array', items: Finding },
    confidence: { type: 'number', minimum: 0, maximum: 1 } } }
const Ruling = { type: 'object', additionalProperties: false, required: ['ruling', 'reason'],
  properties: { ruling: { enum: ['uphold', 'overrule'] }, reason: { type: 'string' } } }
const Escalation = { type: 'object', additionalProperties: false,
  required: ['task_id', 'reason', 'history', 'repeats', 'hypothesis', 'options'],
  properties: { task_id: { type: 'string' },
    reason: { enum: ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings'] },
    history: { type: 'array', items: { type: 'string' } },
    repeats: { type: 'array', items: Finding },
    hypothesis: { type: 'string' },
    options: { type: 'array', items: { enum: ['guide', 'direct_drive', 'kill_to_spec'] } } } }
const Suite = { type: 'object', additionalProperties: false, required: ['artifact_ref', 'passed', 'failed', 'results_ref', 'conflicts'],
  properties: { artifact_ref: { type: 'string' }, passed: { type: 'integer' }, failed: { type: 'integer' },
    results_ref: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } } } }

// ---- pure-code edges ----
const dedupe = (fs) => [...new Map(fs.map(f => [f.dedupe_key, f])).values()]

function adjudicate(verdicts) {
  const veto = verdicts.find(v => v.lens === VETO_LENS && v.verdict === 'fail')
  if (veto) return { result: 'fail', veto_by: veto.lens, split: false }
  const rest = verdicts.filter(v => v.lens !== VETO_LENS)
  const fails = rest.filter(v => v.verdict === 'fail')
  const split = fails.length > 0 && fails.length < rest.length
  const swing = split ? Math.min(...rest.map(v => v.confidence)) : 1
  if (split && swing < 0.7) return { result: null, split: true }
  return { result: fails.length > rest.length / 2 ? 'fail' : 'pass', split: false }
}

function shouldEscalate(ctx, findings) {
  if (ctx.round >= K_ROUNDS) return 'max_rounds'
  if (ctx.tokens > TASK_TOKENS) return 'budget'
  const keys = findings.map(f => f.dedupe_key)
  if (ctx.round > 1 && keys.some(k => ctx.seen.has(k))) return 'repeat_finding'
  if (!keys.some(k => !ctx.seen.has(k))) return 'no_fresh_findings'
  return null
}

// =====================================================================
phase('Implement+Verify')
// Topological order on depends_on (code). Dependents start after their dependency and branch from its task branch.
function topo(items) {
  const byId = new Map(items.map(i => [i.task.id, i])), out = [], seen = new Set()
  const visit = (i, stack = new Set()) => {
    if (seen.has(i.task.id)) return
    if (stack.has(i.task.id)) throw new Error(`depends_on cycle at ${i.task.id}`)
    stack.add(i.task.id)
    for (const d of i.task.depends_on ?? []) if (byId.has(d)) visit(byId.get(d), stack)
    seen.add(i.task.id); out.push(i)
  }
  items.forEach(i => visit(i))
  return out
}
const tasks = topo(A.specs.flatMap(({ spec, graph }) => graph.tasks.map(task => ({ spec, task }))))
log(`${tasks.length} tasks across ${A.specs.length} specs`)

const panelResults = []
const escalations = []
const taskDone = {}, resolveTask = {}
for (const { task } of tasks) taskDone[task.id] = new Promise(r => { resolveTask[task.id] = r })

const finished = (await pipeline(tasks, async (item) => {
  const out = await runTask(item)
  resolveTask[item.task.id](out)
  return out
})).filter(Boolean)

async function runTask({ spec, task }) {
  const wt = `${ART}/worktrees/${task.id}`
  const depIds = (task.depends_on ?? []).filter(d => taskDone[d])
  const deps = await Promise.all(depIds.map(d => taskDone[d]))
  if (deps.some(d => !d || !d.passed)) {
    log(`${task.id}: skipped, a dependency did not pass`)
    return { spec, task, passed: false, skipped: true }
  }
  const base = deps.length ? `task/${deps[deps.length - 1].task.id}` : BASE
  const extraMerges = deps.slice(0, -1).map(d => `task/${d.task.id}`)

  // ---- Implementer ∥ Test Author: both consume only Spec + Task ----
  const [changeSet0, testSet] = await parallel([
    () => agent(`Create a worktree of THIS repository on a new branch: git worktree add -b task/${task.id} ${wt} ${base} (skip if it exists).
                 ${extraMerges.length ? `First merge ${extraMerges.join(', ')} into the branch. ` : ''}The app is at ${wt}/${APP}/ (run npm ci there if node_modules is missing).
                 Implement this task there, staying inside owned surfaces (paths are repository-relative). Commit your work on the task branch.
                 Then write the cumulative diff vs ${base} (git diff ${base}...HEAD, run inside the worktree) to ${ART}/diffs/${task.id}.r0.patch
                 and return that path as diff_ref; base_commit = the sha of ${base}; worktree = "${wt}".
                 Task: ${JSON.stringify(task)}. Spec: ${JSON.stringify(spec)}.`,
      { label: `impl:${task.id}`, model: MODEL.mid, ...AT('implementer'), schema: ChangeSet }),
    () => agent(`Write tests FROM THE SPEC ONLY — do not read any implementation. Cover criteria ${JSON.stringify(task.criteria_ids)}.
                 Write them under ${ART}/tests/${task.id}/ and return the path as tests_ref. ${A.test_hint ?? ''}
                 Task: ${JSON.stringify(task)}. Spec: ${JSON.stringify(spec)}.`,
      { label: `tests:${task.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestSet }),
  ])
  if (!changeSet0 || !testSet) return null

  let changeSet1 = changeSet0
  if (A.canary && (A.canary.task_id === task.id || A.canary.spec_id === spec.id)) {
    log(`canary: injecting a deliberate defect into ${task.id}`)
    const mutated = await agent(`CANARY MUTATION — a deliberate defect to test the verifiers, on purpose. In worktree ${wt} (app at ${wt}/${APP}/, branch task/${task.id})
                                 apply exactly this change to the implementation and commit it: ${A.canary.mutation}
                                 Then rewrite the cumulative diff vs ${BASE} to ${changeSet0.diff_ref} and return the ChangeSet unchanged except notes = "canary".
                                 ChangeSet: ${JSON.stringify(changeSet0)}`,
      { label: `canary:${task.id}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    if (mutated) changeSet1 = { ...mutated, notes: undefined }
  }

  const ctx = { spec, task, changeSet: changeSet1, testSet, seen: new Set(), round: 0, tokens: 0, history: [] }

  // ---- Verify → Fix cycle ----
  for (;;) {
    ctx.round += 1
    const { notes: _hidden, ...diffOnly } = ctx.changeSet   // lenses never see implementer rationale

    // Test Runner: mechanical agent (script cannot run shell). Only Correctness waits on it.
    const runP = agent(`In worktree ${wt} the change is already committed on branch task/${task.id}. Run the tests at ${ctx.testSet.tests_ref}
                        against the app at ${wt}/${APP}/ (npm ci there first if node_modules is missing). ${A.run_hint ?? ''}
                        Write results (per-test pass/fail and failure output) to ${ART}/results/${task.id}.r${ctx.round}.json and return the summary.`,
      { label: `run:${task.id}:r${ctx.round}`, model: MODEL.cheap, ...AT('mechanical'), schema: TestResults })

    const lens = (name, focus, extra = '') =>
      agent(`You are the ${name} reviewer. Your job is to REJECT this change. A pass is only valid if you list at least
             three concrete attempts you made to break it. ${focus}
             Spec: ${JSON.stringify(spec)}. Change (read the diff at diff_ref): ${JSON.stringify(diffOnly)}. ${extra}
             Every finding needs location, claim, evidence, and dedupe_key = "<location>|<short normalized claim>".`,
        { label: `lens:${name}:${task.id}:r${ctx.round}`, model: MODEL.cheap, ...AT(`lens-${name.replace(/_/g, '-')}`), schema: Verdict })

    const sealVerdict = (v, model) => ({ ...v, change_set_id: ctx.changeSet.id, provenance: stamp(`lens:${v.lens}`, model, 'dark_factory') })
    const verdicts = (await parallel([
      () => lens('spec_conformance', 'Does it do exactly what the spec says — nothing more, nothing less?'),
      () => lens('security', `Focus on ${JSON.stringify(spec.touched_surfaces)}: injection, authz, secrets, data exposure.`),
      async () => { const r = await runP; return r && lens('correctness',
        'Do the tests exercise the acceptance criteria? Are passes meaningful? Is anything untested?',
        `Tests: ${JSON.stringify(ctx.testSet)}. Results: ${JSON.stringify(r)}.`) },
    ])).filter(Boolean).map(v => sealVerdict(v, MODEL.cheap))

    let { result, veto_by, split } = adjudicate(verdicts)
    if (split) {
      const tie = await agent(`Adjudicate a split review. Verdicts: ${JSON.stringify(verdicts)}. Spec: ${JSON.stringify(spec)}. Change: ${JSON.stringify(diffOnly)}.`,
        { label: `tiebreak:${task.id}:r${ctx.round}`, model: MODEL.strong, schema: Verdict })
      if (tie) { verdicts.push(sealVerdict(tie, MODEL.strong)); result = tie.verdict } else result = 'fail'
    }
    const findings = dedupe(verdicts.flatMap(v => v.findings))
    panelResults.push({ change_set_id: ctx.changeSet.id, result, veto_by, verdicts, findings, round: ctx.round })
    ctx.history.push(`r${ctx.round}: ${result} (${findings.length} findings${veto_by ? `, veto by ${veto_by}` : ''})`)

    if (result === 'pass') return { ...ctx, passed: true }

    const reason = shouldEscalate(ctx, findings)
    if (reason) {
      const esc = await agent(`Write an Escalation for a human. Reason: ${reason}. History: ${JSON.stringify(ctx.history)}.
                               Open findings: ${JSON.stringify(findings)}. Spec: ${JSON.stringify(spec)}.
                               One-line hypothesis for why this is stuck. Options: guide, direct_drive, kill_to_spec.`,
        { label: `escalate:${task.id}`, model: MODEL.strong, schema: Escalation })
      if (esc) escalations.push(esc)
      return { ...ctx, passed: false }
    }

    // ---- Fix Loop: dedupe against SEEN, fan out fixers, rule on disputes, merge ----
    const fresh = findings.filter(f => !ctx.seen.has(f.dedupe_key))
    fresh.forEach(f => ctx.seen.add(f.dedupe_key))

    const patches = (await parallel(fresh.map(f => () =>
      agent(`Fix ONE finding in worktree ${wt} (app at ${wt}/${APP}/, branch task/${task.id}). Location: ${f.location}. Evidence: ${f.evidence}.
             Stay inside owned surfaces ${JSON.stringify(task.owned_surfaces)}. Commit the fix on the task branch.
             Write the incremental diff of your commit to ${ART}/diffs/${task.id}.r${ctx.round}.${f.id}.patch and return it as diff_ref.
             Do not modify tests under ${ART}/tests/.
             If you are confident the finding is WRONG, make no change and set notes to "DISPUTE: <why>".`,
        { label: `fix:${task.id}:${f.id}`, model: MODEL.mid, ...AT('fixer'), schema: ChangeSet })))).filter(Boolean)

    const disputed = patches.filter(p => p.notes?.startsWith('DISPUTE:'))
    const applied = patches.filter(p => !p.notes?.startsWith('DISPUTE:'))
    if (disputed.length) {
      await parallel(disputed.map(p => () =>
        agent(`Rule on a disputed finding. Spec: ${JSON.stringify(spec)}. Dispute: ${p.notes}.`,
          { label: `dispute:${task.id}`, model: MODEL.strong, schema: Ruling })))
      // Upheld or overruled, the key stays in `seen`: the lens cannot re-raise it, and a re-raise is a repeat → escalate.
    }

    const merged = await agent(`In worktree ${wt} (branch task/${task.id}) the fixes ${JSON.stringify(applied.map(p => p.diff_ref))} are already committed.
                                Verify each is present (git log); if one is missing, apply it with git apply and commit. Write the cumulative diff vs ${BASE}
                                (git diff ${BASE}...HEAD) to ${ART}/diffs/${task.id}.r${ctx.round}.patch and return the ChangeSet with revision ${ctx.changeSet.revision + 1}
                                and that path as diff_ref. Previous ChangeSet: ${JSON.stringify({ ...ctx.changeSet, notes: undefined })}`,
      { label: `merge:${task.id}:r${ctx.round}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    if (!merged) return { ...ctx, passed: false }
    ctx.changeSet = { ...merged, notes: undefined }
  }
}

// =====================================================================
phase('Integrate')   // the one earned barrier
const passing = finished.filter(f => f.passed).map(f => f.changeSet)   // `finished` is already in topological order
log(`${passing.length}/${finished.length} tasks passed; ${escalations.length} escalated; ${finished.filter(f => f.skipped).length} skipped on a failed dependency`)

const suite = await agent(`Create worktree ${ART}/worktrees/integration-${A.run_id} on a new branch integration/${A.run_id} from ${BASE}
                           (git worktree add -b integration/${A.run_id} ${ART}/worktrees/integration-${A.run_id} ${BASE}). Merge these task branches into it in order:
                           ${JSON.stringify(passing.map(c => `task/${c.task_id}`))}. Resolve conflicts minimally and list any files you touched in conflicts.
                           Then run the FULL test suite of the app at <worktree>/${APP}/ (npm ci if needed, then npm test). artifact_ref = "integration/${A.run_id}".
                           Write results to ${ART}/integration/${A.run_id}.json and return the summary.`,
  { label: 'integrate', model: MODEL.cheap, ...AT('mechanical'), schema: Suite })

// =====================================================================
phase('Evidence')   // assembled by code from what streamed in
return {
  release_candidate_id: `rc-${A.run_id}`,
  project_id: A.project_id,
  iteration: A.iteration,
  artifact_ref: suite?.artifact_ref ?? 'INTEGRATION_FAILED',
  specs: A.specs.map(s => s.spec.id),
  panel_results: panelResults,
  suite: { passed: suite?.passed ?? 0, failed: suite?.failed ?? 0, results_ref: suite?.results_ref ?? '' },
  escalations,
  starved_items: [],
  // Output tokens only, shared pool for the turn; the ledger append after the run carries the runtime's real figure.
  spend: { tokens: Math.max(0, budget.spent() - TOKENS_AT_START), wall_clock_min: 0, human_min: 0 },
  provenance: stamp('build-implement', 'n/a', 'hotl'),
}
