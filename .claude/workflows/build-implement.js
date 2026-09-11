export const meta = {
  name: 'build-implement',
  description: 'Implement approved specs: implementer and test author in parallel per task, adversarial verifier panel, converging fix loop, one integration barrier, evidence bundle out.',
  phases: [{ title: 'Implement+Verify', detail: 'per task: implementer ∥ test author → panel → fix loop' }, { title: 'Integrate', detail: 'the one barrier' }, { title: 'Evidence', detail: 'assembled by code' }],
}

// args: { repo, project_id, iteration, specs: [{spec, graph, spec_ref?}], run_id, now,
//   spec_ref: path to the full Spec JSON in the artifact store. When present, agents read it there and only a summary
//             (id, goal, touched_surfaces, out_of_scope) is inlined (CLAUDE.md rule 4: large artifacts cross edges by ref).
//         budget?: { task_tokens }, k_rounds?, artifact_dir?, base?,
//         canary?: { task_id? | spec_id?, mutation: string }, test_hint?: string, run_hint?: string, max_fixers? (default 4) }
//   test_dir: where landed TestSets go, relative to the worktree root (default "<repo>/test"). The repo's own test
//         runner must actually pick this glob up — for venture-0 work on the plant, repo is "." and this is
//         "substrate/test". A test landed where the runner does not look is a green suite that proves nothing.
//   repo: a directory of THIS git repository (e.g. "toy"). Worktrees are of the repository at base (default HEAD),
//         one branch per task (task/<task_id>); the app is at <worktree>/<repo>/.
//   canary: a deliberate defect injected into one task's change set before verification (OPERATING_MODEL §2.4.4).
//   verify_only: { [task_id]: { branch, base } } — re-panel an EXISTING branch: no implementer; a mechanical agent checks it out
//         and writes the diff base...branch; test author, panel, fix loop and integration run as usual. For re-verification
//         (r5's adjudication defect) and for Maintain. A re-run of an already-merged change is otherwise a zero-byte diff.
// returns: EvidenceBundle (see contracts.schema.json)
//
// Human touchpoints: none inside this run. Escalations come back in the bundle;
// the human handles them in chat and re-runs for the affected specs.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const K_ROUNDS = A.k_rounds ?? 3
// Fixer fan-out cap per round. Informed assumption from r1 (3–4 findings per security veto, 7 worst case): 4.
// Deferred findings are logged, stay out of `seen`, and are re-raised as fresh next round. Tune from the ledger.
const MAX_FIXERS = A.max_fixers ?? 4
const LENSES = ['spec_conformance', 'security', 'correctness']
const SEV = { high: 0, medium: 1, low: 2 }
const TASK_TOKENS = A.budget?.task_tokens ?? 250000
const ART = A.artifact_dir ?? '.artifacts'
const BASE = A.base ?? 'HEAD'
// .claude/agents/ definitions register at session start; a session that predates them must pass agent_types:false
// (an unknown agentType throws and drops the task).
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const APP = `${A.repo}`
// Where landed TestSets go, relative to the worktree root. Defaults to <repo>/test, which is right for an app like
// toy/. It is NOT right for venture-0 work on the plant itself: there repo is "." and the runner's glob is
// substrate/test/*.test.js, so a test landed in ./test/ would sit where nothing runs it — a green suite proving
// nothing. Pass test_dir explicitly whenever the app's test glob is not <repo>/test/.
const TEST_DIR = A.test_dir ?? `${APP}/test`
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
    results_ref: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } },
    // artifact_ref is a BRANCH NAME and dies with its container. This sha is the durable handle on what the run
    // shipped, and it is the hop Company Memory's Lens Calibrator needs to join Cause.suspect_commit back to a
    // PanelResult (OPERATING_MODEL 8). Stamped into EvidenceBundle.integration_commit below.
    integration_commit: { type: 'string', description: 'full sha of the integration branch HEAD after merging and landing tests' },
    tests_landed: { type: 'array', items: { type: 'string' }, description: 'TestSet files copied into the repo test dir and committed' },
    tests_skipped: { type: 'array', items: { type: 'string' }, description: 'TestSet files NOT copied because a file of that name already exists. Reported, never overwritten.' } } }

// ---- pure-code edges ----
const dedupe = (fs) => [...new Map(fs.map(f => [f.dedupe_key, f])).values()]

// A verdict is derived from its findings, not declared beside them (r8: correctness listed a high-severity defect and said pass).
// Findings are defects only, so any finding other than a SPEC-LEVEL note makes the lens a fail. Code decides; the lens only detects.
const SPEC_LEVEL = /^SPEC-LEVEL:/
function normalizeVerdict(v, tag) {
  const defects = (v.findings ?? []).filter(f => !SPEC_LEVEL.test(String(f.claim)))
  if (v.verdict === 'pass' && defects.length) {
    log(`${tag} ${v.lens}: said pass but listed ${defects.length} defect(s); recorded as fail`)
    return { ...v, verdict: 'fail' }
  }
  return v
}

// Lenses receive DIFFERENT inputs (OPERATING_MODEL §2.4): they are independent detectors, not redundant voters, so there is
// no majority rule. Security is a veto. Any other confident fail fails the panel. A fail held only at low confidence
// (every failing lens < 0.7) goes to the Tiebreak Judge. r5 shipped four tasks over a failing lens under the old majority rule.
const LOW_CONFIDENCE = 0.7
function adjudicate(verdicts) {
  const veto = verdicts.find(v => v.lens === VETO_LENS && v.verdict === 'fail')
  if (veto) return { result: 'fail', veto_by: veto.lens, split: false }
  const fails = verdicts.filter(v => v.verdict === 'fail')
  if (!fails.length) return { result: 'pass', split: false }
  if (fails.every(v => v.confidence < LOW_CONFIDENCE)) return { result: null, split: true }
  return { result: 'fail', split: false }
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
const tasks = topo(A.specs.flatMap(({ spec, graph, spec_ref }) => graph.tasks.map(task => ({ spec, task, spec_ref }))))
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

async function runTask({ spec, task, spec_ref }) {
  const wt = `${ART}/worktrees/${task.id}`
  const specText = spec_ref
    ? `Spec: the FULL spec (acceptance criteria, touched surfaces, out of scope) is at ${spec_ref}; read it before acting. Summary: ${JSON.stringify({ id: spec.id, goal: spec.goal, touched_surfaces: spec.touched_surfaces, out_of_scope: spec.out_of_scope })}`
    : `${specText}`
  const depIds = (task.depends_on ?? []).filter(d => taskDone[d])
  const deps = await Promise.all(depIds.map(d => taskDone[d]))
  if (deps.some(d => !d || !d.passed)) {
    log(`${task.id}: skipped, a dependency did not pass`)
    return { spec, task, passed: false, skipped: true }
  }
  const vo = A.verify_only?.[task.id]
  const branch = vo ? vo.branch : `task/${task.id}`
  const base = vo ? vo.base : (deps.length ? `task/${deps[deps.length - 1].task.id}` : BASE)
  const extraMerges = deps.slice(0, -1).map(d => `task/${d.task.id}`)

  // ---- Implementer ∥ Test Author: both consume only Spec + Task ----
  const [changeSet0, testSet] = await parallel([
    () => vo ? agent(`VERIFY ONLY: the change already exists on branch ${branch}. Check it out: git worktree add ${wt} ${branch} (skip if ${wt} exists).
                 App at ${wt}/${APP}/ (npm ci there if node_modules is missing). Do NOT modify any code. Write the cumulative diff ${base}...${branch}
                 (git diff ${base}...HEAD inside the worktree) to ${ART}/diffs/${task.id}.r0.patch and return that path as diff_ref; it must be non-empty,
                 and if it is empty say so in notes. base_commit = the sha of ${base}; worktree = "${wt}"; revision 0; touched_surfaces from the diff.
                 Task: ${JSON.stringify(task)}.`,
      { label: `checkout:${task.id}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    : agent(`Create a worktree of THIS repository on a new branch: git worktree add -b task/${task.id} ${wt} ${base} (skip if it exists).
                 ${extraMerges.length ? `First merge ${extraMerges.join(', ')} into the branch. ` : ''}The app is at ${wt}/${APP}/ (run npm ci there if node_modules is missing).
                 Implement this task there, staying inside owned surfaces (paths are repository-relative). Commit your work on the task branch.
                 Then write the cumulative diff vs ${base} (git diff ${base}...HEAD, run inside the worktree) to ${ART}/diffs/${task.id}.r0.patch
                 and return that path as diff_ref; base_commit = the sha of ${base}; worktree = "${wt}".
                 Task: ${JSON.stringify(task)}. ${specText}.`,
      { label: `impl:${task.id}`, model: MODEL.mid, ...AT('implementer'), schema: ChangeSet }),
    () => agent(`Write tests FROM THE SPEC ONLY — do not read any implementation. Cover criteria ${JSON.stringify(task.criteria_ids)}.
                 Write them under ${ART}/tests/${task.id}/ and return the path as tests_ref. ${A.test_hint ?? ''}
                 Task: ${JSON.stringify(task)}. ${specText}.`,
      { label: `tests:${task.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestSet }),
  ])
  if (!changeSet0 || !testSet) return null

  let changeSet1 = changeSet0
  if (A.canary && (A.canary.task_id === task.id || A.canary.spec_id === spec.id)) {
    log(`canary: injecting a deliberate defect into ${task.id}`)
    const mutated = await agent(`CANARY MUTATION — a deliberate defect to test the verifiers, on purpose. In worktree ${wt} (app at ${wt}/${APP}/, branch ${branch})
                                 apply exactly this change to the implementation and commit it with the message "tidy handler" (never mention canary, mutation, or test in the commit,
                                 the code, or comments; the verifiers must not be able to tell): ${A.canary.mutation}
                                 Then rewrite the cumulative diff vs ${base} to ${changeSet0.diff_ref} and return the ChangeSet unchanged except notes = "canary".
                                 ChangeSet: ${JSON.stringify(changeSet0)}`,
      { label: `canary:${task.id}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    if (mutated) changeSet1 = { ...mutated, notes: undefined }
  }

  // Lens re-run policy: after a fix, re-run only the lenses that failed until they pass, then confirm the ones that had passed.
  // If a confirm run fails, run all three until green (mode 'all'). Confirm runs do not count toward K_ROUNDS.
  const ctx = { spec, task, changeSet: changeSet1, testSet, seen: new Set(), round: 0, tokens: 0, history: [], overruled: [], upheld: [],
                mode: 'retry', toRun: LENSES, verified: new Set() }
  const fileOf = (loc) => String(loc).split(':')[0].trim()

  // ---- Verify → Fix cycle ----
  let confirming = false
  for (;;) {
    if (!confirming) ctx.round += 1
    const tag = `r${ctx.round}${confirming ? 'c' : ''}`
    const toRun = ctx.toRun
    const { notes: _hidden, ...diffOnly } = ctx.changeSet   // lenses never see implementer rationale

    // Test Runner: mechanical agent (script cannot run shell). Only Correctness waits on it; skipped when Correctness is not re-run.
    const runP = !toRun.includes('correctness') ? null : agent(`In worktree ${wt} the change is already committed on branch ${branch}. Run the tests at ${ctx.testSet.tests_ref}
                        against the app at ${wt}/${APP}/ (npm ci there first if node_modules is missing). ${A.run_hint ?? ''}
                        Write results (per-test pass/fail and failure output) to ${ART}/results/${task.id}.r${ctx.round}.json and return the summary.`,
      { label: `run:${task.id}:${tag}`, model: MODEL.cheap, ...AT('mechanical'), schema: TestResults })

    const overruledNote = ctx.overruled.length
      ? `A judge has OVERRULED these earlier findings because the spec requires that behavior. Do not raise them or paraphrases of them
         again; a re-raise is a repeat that fails the lens, not the change: ${JSON.stringify(ctx.overruled.map(o => ({ lens: o.lens, location: o.location, claim: o.claim })))}.`
      : ''
    const lens = (name, focus, extra = '') =>
      agent(`You are the ${name} reviewer. Your job is to REJECT this change. A pass is only valid if you list at least
             three concrete attempts you made to break it. ${focus}
             Findings are DEFECTS ONLY: an attack you tried that the change blocks is an attempt, not a finding. Behavior the spec
             requires is never a finding. If you believe the spec itself is unsafe, record ONE finding with severity "low" and a claim
             starting "SPEC-LEVEL:" and do not fail the change on it alone. ${overruledNote}
             ${specText}. Change (read the diff at diff_ref): ${JSON.stringify(diffOnly)}. ${extra}
             Every finding needs location (path:line), claim, evidence, status "open", and dedupe_key = "<location>|<short normalized claim>".`,
        { label: `lens:${name}:${task.id}:${tag}`, model: MODEL.cheap, ...AT(`lens-${name.replace(/_/g, '-')}`), schema: Verdict })
        .then(v => v && normalizeVerdict({ ...v, lens: name }, tag))   // the script names the lens; the agent does not

    const sealVerdict = (v, model) => ({ ...v, change_set_id: ctx.changeSet.id, provenance: stamp(`lens:${v.lens}`, model, 'dark_factory') })
    const lensThunks = {
      // touched_surfaces is a permission envelope, not a mandate (rulings r5 and c1 both overruled "listed surface not touched"; the
      // c1 lens re-raised it and forced an escalation). Only work outside the envelope, or a criterion left unmet, is a finding.
      spec_conformance: () => lens('spec_conformance', `Does it do exactly what the spec says — nothing more, nothing less?
             spec.touched_surfaces is the set of surfaces the change MAY touch, never a list it MUST touch: a listed surface the diff leaves
             alone is not a finding. Acceptance tests are written by a separate Test Author under ${ART}/tests/, so a test file the spec
             names is never expected in the diff. Fail only for work outside the envelope, out_of_scope work, or a criterion the diff leaves unmet.`),
      security: () => lens('security', `Focus on ${JSON.stringify(spec.touched_surfaces)}: injection, authz, secrets, data exposure BEYOND what the spec requires.
                               A fail must cite a defect in how the change implements the spec, never the spec's own goal.`),
      correctness: async () => { const r = await runP; return r && lens('correctness',
        'Do the tests exercise the acceptance criteria? Are passes meaningful? Is anything untested?',
        `Tests: ${JSON.stringify(ctx.testSet)}. Results: ${JSON.stringify(r)}.`) },
    }
    const verdicts = (await parallel(toRun.map(l => lensThunks[l]))).filter(Boolean).map(v => sealVerdict(v, MODEL.cheap))

    let { result, veto_by, split } = adjudicate(verdicts)
    if (split) {
      const tie = await agent(`Adjudicate a split review. Verdicts: ${JSON.stringify(verdicts)}. ${specText}. Change: ${JSON.stringify(diffOnly)}.`,
        { label: `tiebreak:${task.id}:${tag}`, model: MODEL.strong, schema: Verdict })
      if (tie) { verdicts.push(sealVerdict(tie, MODEL.strong)); result = tie.verdict } else result = 'fail'
    }
    const findings = dedupe(verdicts.flatMap(v => v.findings))
    panelResults.push({ change_set_id: ctx.changeSet.id, result, veto_by, verdicts, findings, round: ctx.round })
    ctx.history.push(`${tag} [${toRun.join(',')}]: ${result} (${findings.length} findings${veto_by ? `, veto by ${veto_by}` : ''})`)

    if (result === 'pass') {
      toRun.forEach(l => ctx.verified.add(l))
      const remaining = LENSES.filter(l => !ctx.verified.has(l))
      if (remaining.length) {   // failures cleared; now confirm the lenses that had passed before the fix
        ctx.toRun = remaining; confirming = true
        ctx.history.push(`${tag}: confirming ${remaining.join(',')}`)
        continue
      }
      return { ...ctx, passed: true, branch }
    }
    const failedLenses = verdicts.filter(v => v.verdict === 'fail' && v.lens !== 'tiebreak').map(v => v.lens)
    if (confirming) { ctx.mode = 'all'; ctx.history.push(`${tag}: a previously passing lens failed after a fix; running all lenses until green`) }
    confirming = false
    ctx.toRun = ctx.mode === 'all' ? LENSES : (failedLenses.length ? failedLenses : toRun)

    // Escalation Packager: code supplies reason, repeats and disputes; the strong model supplies the hypothesis.
    const escalate = async (reason, open) => {
      const repeats = open.filter(f => ctx.overruled.some(o => o.lens === f.lens && fileOf(o.location) === fileOf(f.location)))
      const esc = await agent(`Write an Escalation for a human. Reason: ${reason}. History: ${JSON.stringify(ctx.history)}.
                               Open findings: ${JSON.stringify(open)}. Repeats: ${JSON.stringify(repeats)}.
                               Disputes lost (fixer disputed, judge upheld): ${JSON.stringify(ctx.upheld)}. Overruled by judge: ${JSON.stringify(ctx.overruled)}.
                               ${specText}. One-line hypothesis for why this is stuck. Options: guide, direct_drive, kill_to_spec.`,
        { label: `escalate:${task.id}`, model: MODEL.strong, schema: Escalation })
      if (esc) escalations.push({ ...esc, task_id: task.id, reason, repeats, disputes_lost: ctx.upheld })
      return { ...ctx, passed: false }
    }

    const reason = shouldEscalate(ctx, findings)
    if (reason) return escalate(reason, findings)

    // ---- Fix Loop: dedupe against SEEN, fan out fixers, rule on disputes, merge ----
    const freshAll = findings.filter(f => !ctx.seen.has(f.dedupe_key)).sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9))
    const fresh = freshAll.slice(0, MAX_FIXERS)
    const deferred = freshAll.slice(MAX_FIXERS)
    fresh.forEach(f => ctx.seen.add(f.dedupe_key))   // deferred findings stay out of `seen` and come back as fresh next round
    if (deferred.length) { log(`${task.id} ${tag}: fixer cap ${MAX_FIXERS}; deferred ${deferred.length} finding(s)`); ctx.history.push(`${tag}: deferred ${deferred.length} findings past the fixer cap: ${deferred.map(d => d.id).join(',')}`) }

    const isTestFinding = (f) => String(f.location).includes(`${ART}/tests/`) || String(f.location).includes(ctx.testSet.tests_ref)
    const TestRepair = { type: 'object', additionalProperties: false, required: ['tests_ref', 'criteria_coverage'],
      properties: { tests_ref: { type: 'string' }, criteria_coverage: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
    const fixes = (await parallel(fresh.map(f => () => isTestFinding(f)
      ? agent(`A verifier found a defect in the TESTS you wrote from the spec, not in the implementation. Location: ${f.location}. Evidence: ${f.evidence}.
             Re-read the spec (${specText}). Repair the test under ${ctx.testSet.tests_ref} so it asserts exactly what the spec says; do not read or modify
             the implementation. If the test is right and the finding is wrong, change nothing and set notes to "DISPUTE: <why>". ${A.test_hint ?? ''}
             Return tests_ref and the criteria the tests now cover.`,
          { label: `testfix:${task.id}:${f.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestRepair }).then(p => p && { f, p, kind: 'test' })
      : agent(`Fix ONE finding in worktree ${wt} (app at ${wt}/${APP}/, branch ${branch}). Location: ${f.location}. Evidence: ${f.evidence}.
             Stay inside owned surfaces ${JSON.stringify(task.owned_surfaces)}. Commit the fix on branch ${branch}.
             Write the incremental diff of your commit to ${ART}/diffs/${task.id}.r${ctx.round}.${f.id}.patch and return it as diff_ref.
             Do not modify tests under ${ART}/tests/.
             Spec goal: ${spec.goal} Out of scope — never add any of these to satisfy a finding: ${JSON.stringify(spec.out_of_scope ?? [])}.
             FIRST reproduce the finding empirically (run the code, a request, or the test it cites); lenses are read-only and can
             only assert runtime behavior, you can check it. If it does not reproduce, or it objects to behavior the spec requires, or
             asks for something out of scope, make no change and set notes to "DISPUTE: <what you ran and what it showed>".`,
        { label: `fix:${task.id}:${f.id}`, model: MODEL.mid, ...AT('fixer'), schema: ChangeSet }).then(p => p && { f, p, kind: 'code' })))).filter(Boolean)

    const disputed = fixes.filter(x => x.p.notes?.startsWith('DISPUTE:'))
    const testRepairs = fixes.filter(x => x.kind === 'test' && !x.p.notes?.startsWith('DISPUTE:'))
    if (testRepairs.length) {
      ctx.testSet = { ...ctx.testSet, tests_ref: testRepairs[testRepairs.length - 1].p.tests_ref }
      ctx.history.push(`${tag}: ${testRepairs.length} test finding(s) repaired by the Test Author`)
    }
    const applied = fixes.filter(x => x.kind === 'code' && !x.p.notes?.startsWith('DISPUTE:')).map(x => x.p)
    if (disputed.length) {
      // Dispute Checker: strong model, never the same lens. Its ruling crosses two edges: the next round's lens prompt and the Escalation.
      const rulings = await parallel(disputed.map(x => () =>
        agent(`Rule on a disputed finding. ${specText}. Finding: ${JSON.stringify(x.f)}. Fixer's dispute: ${x.p.notes}.
               UPHOLD only if the finding names a real defect in how the change implements the spec. OVERRULE if it objects to behavior the
               spec requires, asks for something the spec lists as out of scope, or describes an attack the change already blocks.`,
          { label: `dispute:${task.id}:${x.f.id}`, model: MODEL.mid, schema: Ruling })))   // mid tier: Opus rulings were the largest cost line (ledger, Phases 1–2); Tiebreak stays strong
      // Compare against rulings from EARLIER rounds only: the guard catches a lens re-raising after being overruled, not several
      // overrules inside one round (r6 escalated a green change on that mistake).
      const priorOverruled = [...ctx.overruled]
      let repeatOverrule = false
      disputed.forEach((x, i) => {
        const r = rulings[i]
        if (r?.ruling === 'overrule') {
          if (priorOverruled.some(o => o.lens === x.f.lens && fileOf(o.location) === fileOf(x.f.location))) repeatOverrule = true
          ctx.overruled.push({ ...x.f, status: 'overruled' })
          ctx.history.push(`r${ctx.round}: overruled ${x.f.lens} at ${x.f.location}: ${r.reason}`)
        } else {
          ctx.upheld.push({ ...x.f, status: 'disputed' })
          ctx.history.push(`r${ctx.round}: upheld ${x.f.lens} at ${x.f.location}: ${r?.reason ?? 'no ruling'}`)
        }
      })
      // A lens overruled twice at the same file is arguing with the spec, not the change. Stop paying for rounds.
      if (repeatOverrule) return escalate('repeat_finding', findings)
    }

    if (!applied.length) continue   // nothing changed: previously passing lenses stay verified; only the failing ones re-run

    const merged = await agent(`In worktree ${wt} (branch ${branch}) the fixes ${JSON.stringify(applied.map(p => p.diff_ref))} are already committed.
                                Verify each is present (git log); if one is missing, apply it with git apply and commit. Write the cumulative diff vs ${base}
                                (git diff ${base}...HEAD) to ${ART}/diffs/${task.id}.r${ctx.round}.patch and return the ChangeSet with revision ${ctx.changeSet.revision + 1}
                                and that path as diff_ref. Previous ChangeSet: ${JSON.stringify({ ...ctx.changeSet, notes: undefined })}`,
      { label: `merge:${task.id}:r${ctx.round}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    if (!merged) return { ...ctx, passed: false }
    ctx.changeSet = { ...merged, notes: undefined }
    ctx.verified = new Set()   // code changed: nothing is verified until the failing lenses pass and the rest confirm
  }
}

// =====================================================================
phase('Integrate')   // the one earned barrier
const passing = finished.filter(f => f.passed).map(f => f.changeSet)   // `finished` is already in topological order
const passingBranches = finished.filter(f => f.passed).map(f => f.branch ?? `task/${f.task.id}`)
const passingTests = finished.filter(f => f.passed).map(f => f.testSet?.tests_ref).filter(Boolean)
log(`${passing.length}/${finished.length} tasks passed; ${escalations.length} escalated; ${finished.filter(f => f.skipped).length} skipped on a failed dependency`)

// The TestSets land HERE, not in the task worktrees. The Test Author writes from the spec alone and must never see
// the implementation, so it keeps writing to the artifact store; but a TestSet that stays there is run once and lost,
// which is exactly how 12 work items produced a suite where not one test passed ?q. Landing them at the barrier keeps
// the information asymmetry AND puts the tests in the repo, so the suite number this run reports is the real one.
const landing = passingTests.length
  ? `\n                           BEFORE running the suite, land the tests. For each path in ${JSON.stringify(passingTests)}:
                           that path may be a FILE or a DIRECTORY (both have occurred) — if it is a directory copy every *.test.js
                           inside it, if it is a file copy that file. Copy into <worktree>/${TEST_DIR}/ under its own basename.
                           NEVER overwrite a file that already exists there — skip it and list it in tests_skipped; the repo's
                           copy wins. Do NOT copy helpers.js or any non-test file: the repo has its own helpers and an
                           artifact-store copy may carry absolute worktree paths that would break once moved. Then
                           \`git add -A && git commit -m "tests: land TestSets for ${A.run_id}"\` in the worktree.
                           List what you copied in tests_landed. If a landed test then FAILS, report the failure verbatim in
                           the suite counts — never delete, skip or edit a test to make the suite green.`
  : ''
const suite = await agent(`Create worktree ${ART}/worktrees/integration-${A.run_id} on a new branch integration/${A.run_id} from ${BASE}
                           (git worktree add -b integration/${A.run_id} ${ART}/worktrees/integration-${A.run_id} ${BASE}). Merge these task branches into it in order:
                           ${JSON.stringify(passingBranches)}. Resolve conflicts minimally and list any files you touched in conflicts.${landing}
                           Then run the FULL test suite of the app at <worktree>/${APP}/ (npm ci if needed, then npm test). artifact_ref = "integration/${A.run_id}".
                           Write results to ${ART}/integration/${A.run_id}.json.
                           Finally run \`git rev-parse HEAD\` in the worktree and return its FULL 40-character sha as integration_commit.
                           Copy that sha exactly; if the command fails, leave integration_commit out rather than guessing one.`,
  { label: 'integrate', model: MODEL.cheap, ...AT('mechanical'), schema: Suite })

// AE only on conflict (OPERATING_MODEL §2.1): a strong model re-resolves any files the mechanical merge had to touch, then re-runs the suite.
let finalSuite = suite
if (suite && (suite.conflicts?.length || suite.failed > 0) && passing.length > 1) {
  log(`integration: ${suite.conflicts?.length ?? 0} conflicted file(s), ${suite.failed} failing test(s); strong-model resolution`)
  const resolved = await agent(`Integration branch integration/${A.run_id} in worktree ${ART}/worktrees/integration-${A.run_id} merged ${JSON.stringify(passingBranches)}.
                                A mechanical merge reported conflicts in ${JSON.stringify(suite.conflicts ?? [])} and ${suite.failed} failing test(s) (results at ${suite.results_ref}).
                                Re-examine each conflicted file against the task branches' intents and make the integration branch carry ALL merged behaviors
                                correctly. Commit. Re-run the full suite of the app at <worktree>/${APP}/, write results to ${ART}/integration/${A.run_id}.json
                                and return the summary with artifact_ref = "integration/${A.run_id}" and conflicts = the files you changed.
                                Carry forward tests_landed ${JSON.stringify(suite.tests_landed ?? [])} and tests_skipped ${JSON.stringify(suite.tests_skipped ?? [])} unchanged
                                unless you changed which tests are present. Then run \`git rev-parse HEAD\` in that worktree and return its FULL
                                40-character sha as integration_commit — your commit, not the one the mechanical merge reported. Copy it exactly; omit it if the command fails.`,
    { label: 'integrate:resolve', model: MODEL.strong, schema: Suite })
  if (resolved) finalSuite = resolved
}

// =====================================================================
phase('Evidence')   // assembled by code from what streamed in
return {
  release_candidate_id: `rc-${A.run_id}`,
  project_id: A.project_id,
  iteration: A.iteration,
  artifact_ref: finalSuite?.artifact_ref ?? 'INTEGRATION_FAILED',
  // The durable handle on what this run shipped. Company Memory joins Cause.suspect_commit to this to find the
  // PanelResult that passed a defect; a branch name cannot do that job once the container is gone. Omitted, never
  // faked, when the Integrator could not report one.
  ...(finalSuite?.integration_commit ? { integration_commit: finalSuite.integration_commit } : {}),
  specs: A.specs.map(s => s.spec.id),
  panel_results: panelResults,
  suite: { passed: finalSuite?.passed ?? 0, failed: finalSuite?.failed ?? 0, results_ref: finalSuite?.results_ref ?? '' },
  tests_landed: finalSuite?.tests_landed ?? [],
  tests_skipped: finalSuite?.tests_skipped ?? [],
  escalations,
  starved_items: [],
  // Output tokens only, shared pool for the turn; the ledger append after the run carries the runtime's real figure.
  spend: { tokens: Math.max(0, budget.spent() - TOKENS_AT_START), wall_clock_min: 0, human_min: 0 },
  provenance: stamp('build-implement', 'n/a', 'hotl'),
}
