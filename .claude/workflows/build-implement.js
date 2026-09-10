export const meta = {
  name: 'build-implement',
  description: 'Implement approved specs: implementer and test author in parallel per task, adversarial verifier panel, converging fix loop, one integration barrier, evidence bundle out.',
  phases: [{ title: 'Implement+Verify', detail: 'per task: implementer ∥ test author → panel → fix loop' }, { title: 'Integrate', detail: 'the one barrier' }, { title: 'Evidence', detail: 'assembled by code' }],
}

// args: { repo, project_id, iteration, specs: [{spec, graph}], run_id, now,
//         budget?: { task_tokens }, k_rounds?, artifact_dir? }
// returns: EvidenceBundle (see contracts.schema.json)
//
// Human touchpoints: none inside this run. Escalations come back in the bundle;
// the human handles them in chat and re-runs for the affected specs.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const K_ROUNDS = A.k_rounds ?? 3
const TASK_TOKENS = A.budget?.task_tokens ?? 250000
const ART = A.artifact_dir ?? '.artifacts'
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
const tasks = A.specs.flatMap(({ spec, graph }) => graph.tasks.map(task => ({ spec, task })))
log(`${tasks.length} tasks across ${A.specs.length} specs`)

const panelResults = []
const escalations = []

const finished = (await pipeline(tasks, async ({ spec, task }) => {
  const wt = `${ART}/worktrees/${task.id}`

  // ---- Implementer ∥ Test Author: both consume only Spec + Task ----
  const [changeSet0, testSet] = await parallel([
    () => agent(`Create git worktree ${wt} from ${A.repo} main. Implement this task there, staying inside owned surfaces.
                 Write the diff to ${ART}/diffs/${task.id}.r0.patch and return its path as diff_ref.
                 Task: ${JSON.stringify(task)}. Spec: ${JSON.stringify(spec)}.`,
      { label: `impl:${task.id}`, model: MODEL.mid, agentType: 'implementer', schema: ChangeSet }),
    () => agent(`Write tests FROM THE SPEC ONLY — do not read any implementation. Cover criteria ${JSON.stringify(task.criteria_ids)}.
                 Write them under ${ART}/tests/${task.id}/ and return the path as tests_ref.
                 Task: ${JSON.stringify(task)}. Spec: ${JSON.stringify(spec)}.`,
      { label: `tests:${task.id}`, model: MODEL.mid, agentType: 'test-author', schema: TestSet }),
  ])
  if (!changeSet0 || !testSet) return null

  const ctx = { spec, task, changeSet: changeSet0, testSet, seen: new Set(), round: 0, tokens: 0, history: [] }

  // ---- Verify → Fix cycle ----
  for (;;) {
    ctx.round += 1
    const { notes: _hidden, ...diffOnly } = ctx.changeSet   // lenses never see implementer rationale

    // Test Runner: mechanical agent (script cannot run shell). Only Correctness waits on it.
    const runP = agent(`Apply ${ctx.changeSet.diff_ref} in ${wt} if not already applied, run the tests at ${ctx.testSet.tests_ref},
                        write results to ${ART}/results/${task.id}.r${ctx.round}.json and return the summary.`,
      { label: `run:${task.id}:r${ctx.round}`, model: MODEL.cheap, agentType: 'mechanical', schema: TestResults })

    const lens = (name, focus, extra = '') =>
      agent(`You are the ${name} reviewer. Your job is to REJECT this change. A pass is only valid if you list at least
             three concrete attempts you made to break it. ${focus}
             Spec: ${JSON.stringify(spec)}. Change (read the diff at diff_ref): ${JSON.stringify(diffOnly)}. ${extra}
             Every finding needs location, claim, evidence, and dedupe_key = "<location>|<short normalized claim>".`,
        { label: `lens:${name}:${task.id}:r${ctx.round}`, model: MODEL.cheap, agentType: `lens-${name.replace(/_/g, '-')}`, schema: Verdict })

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
      agent(`Fix ONE finding in worktree ${wt}. Location: ${f.location}. Evidence: ${f.evidence}.
             Stay inside owned surfaces ${JSON.stringify(task.owned_surfaces)}.
             Write the incremental diff to ${ART}/diffs/${task.id}.r${ctx.round}.${f.id}.patch and return it as diff_ref.
             If you are confident the finding is WRONG, make no change and set notes to "DISPUTE: <why>".`,
        { label: `fix:${task.id}:${f.id}`, model: MODEL.mid, agentType: 'fixer', schema: ChangeSet })))).filter(Boolean)

    const disputed = patches.filter(p => p.notes?.startsWith('DISPUTE:'))
    const applied = patches.filter(p => !p.notes?.startsWith('DISPUTE:'))
    if (disputed.length) {
      await parallel(disputed.map(p => () =>
        agent(`Rule on a disputed finding. Spec: ${JSON.stringify(spec)}. Dispute: ${p.notes}.`,
          { label: `dispute:${task.id}`, model: MODEL.strong, schema: Ruling })))
      // Upheld or overruled, the key stays in `seen`: the lens cannot re-raise it, and a re-raise is a repeat → escalate.
    }

    const merged = await agent(`Apply these patches in order in ${wt}: ${JSON.stringify(applied.map(p => p.diff_ref))}.
                                Resolve conflicts minimally. Write the cumulative diff vs base to ${ART}/diffs/${task.id}.r${ctx.round}.patch
                                and return the ChangeSet with revision ${ctx.changeSet.revision + 1}.`,
      { label: `merge:${task.id}:r${ctx.round}`, model: MODEL.cheap, agentType: 'mechanical', schema: ChangeSet })
    if (!merged) return { ...ctx, passed: false }
    ctx.changeSet = { ...merged, notes: undefined }
  }
})).filter(Boolean)

// =====================================================================
phase('Integrate')   // the one earned barrier
const passing = finished.filter(f => f.passed).map(f => f.changeSet)
log(`${passing.length}/${finished.length} tasks passed; ${escalations.length} escalated`)

const suite = await agent(`Merge these worktrees into an integration branch of ${A.repo} in this order: ${JSON.stringify(passing.map(c => c.worktree))}.
                           Resolve conflicts minimally and list any you touched. Run the FULL test suite, build the artifact,
                           write results to ${ART}/integration/${A.run_id}.json and return the summary.`,
  { label: 'integrate', model: MODEL.cheap, agentType: 'mechanical', schema: Suite })

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
