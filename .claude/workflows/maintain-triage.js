export const meta = {
  name: 'maintain-triage',
  description: 'Maintain (OPERATING_MODEL §4): Signal[] → dedupe → triage → (sev1 mitigation ∥ repro → root cause → patch) → verified Patch[] + HealthReport. The sev1 page is the boundary; mitigation is already applied when it opens.',
  phases: [
    { title: 'Intake', detail: 'code: dedupe on fingerprint against the known-issues set; one mechanical read for the base sha' },
    { title: 'Triage', detail: 'one cheap agent per fresh signal; the severity router is code' },
    { title: 'Mitigate', detail: 'sev1 only, once per run, reversible, parallel to diagnosis and before any human sees anything' },
    { title: 'Diagnose', detail: 'repro (up to the attempt cap) → root cause → patch draft, per signal, no barrier' },
    { title: 'Verify', detail: 'mechanical: repro fails at base, passes on the patch, suite green. The verdict is derived here.' },
    { title: 'Incident', detail: 'sev1 only: the page payload, written after the mitigation result is known' },
    { title: 'Health', detail: 'code: HealthReport; mechanical: persist artifacts and the seen-set' },
  ],
}

// args: { project_id, repo, signals: Signal[] (or signals_ref), run_id, now,
//         base?: git ref the repo is diagnosed at (default HEAD) — resolved to a sha once, never substituted,
//         artifact_dir? (default .artifacts), max_repro_attempts? (default 2),
//         known_issues?: [fingerprint], known_issues_ref?: path to a JSON array of fingerprints (the persisted seen-set, §9.9),
//         live?: { env (e.g. "prod"), port, app, rollback_to_ref } — the sev1 mitigation target. Absent = no mitigation is
//                possible and the page says so; a missing rollback_to_ref is never guessed at.
//         health?: { period: {from,to}, slo: [{name,target,actual}], maintain_ratio?, improve_backlog?, prev?: {defects} },
//         new_agent_types?: false — this phase added .claude/agents/{triage,reproducer,root-cause,patch-drafter}.md, which
//                only register at session start; a session that predates them must pass false (they then run as plain tiered agents). }
// returns: { patches: Patch[], parked: [{signal_id, repro}], dropped: {duplicates, noise}, triages: Triage[],
//            health: HealthReport, mitigation?: Mitigation, incident?: IncidentRecord,
//            gate?: { gate, options, next, payload_ref }, refs, provenance }
//
// Human touchpoints: zero for sev2/sev3. One for a sev1 — the page, opened by the main session AFTER this run returns:
//   gates open --gate sev1_page --run <run_id> --workflow maintain-triage --options <incident.page_options> \
//              --payload <incident>.json --project <project_id> --next build-reentry
// The mitigation is applied and its evidence file is on disk before that gate record exists: the ordering is structural,
// not a promise. /build-reentry verifies the CLOSED record by id before it will classify a sev1 patch.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const NEW = (t) => (A.new_agent_types === false ? {} : { agentType: t })
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
const ART = A.artifact_dir ?? '.artifacts'
const DIR = `${ART}/maintain/${A.run_id}`
const APP = A.repo
const project = A.project_id
const MAX_REPRO = A.max_repro_attempts ?? 2
const BASE_REF = A.base ?? 'HEAD'

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const Surface = { type: 'object', additionalProperties: false, required: ['kind', 'ref'],
  properties: { kind: { enum: ['path', 'module', 'api', 'schema', 'config', 'infra'] }, ref: { type: 'string' } } }
const TriageC = { type: 'object', additionalProperties: false, required: ['severity', 'category', 'surfaces', 'reproducible', 'rationale'],
  properties: { severity: { enum: ['sev1', 'sev2', 'sev3', 'noise'] },
    category: { enum: ['bug', 'perf', 'security', 'data', 'infra', 'ux', 'unknown'] },
    surfaces: { type: 'array', items: Surface }, reproducible: { enum: ['likely', 'unlikely', 'unknown'] }, rationale: { type: 'string' } } }
const ReproC = { type: 'object', additionalProperties: false, required: ['status', 'steps', 'observed', 'expected', 'notes'],
  properties: { status: { enum: ['reproduced', 'cannot_repro'] }, failing_test_ref: { type: 'string' }, steps: { type: 'string' },
    observed: { type: 'string' }, expected: { type: 'string' }, notes: { type: 'string' } } }
const CauseC = { type: 'object', additionalProperties: false, required: ['location', 'hypothesis', 'confidence'],
  properties: { location: { type: 'string' }, hypothesis: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    suspect_commit: { type: 'string' }, surfaces: { type: 'array', items: Surface } } }
const ChangeSetC = { type: 'object', additionalProperties: false,
  required: ['id', 'worktree', 'base_commit', 'diff_ref', 'branch', 'touched_surfaces', 'revision'],
  properties: { id: { type: 'string' }, task_id: { type: 'string' }, spec_id: { type: 'string' }, worktree: { type: 'string' },
    base_commit: { type: 'string' }, diff_ref: { type: 'string' }, branch: { type: 'string' },
    touched_surfaces: { type: 'array', items: Surface }, notes: { type: 'string' }, revision: { type: 'integer' } } }
const Counts = { type: 'object', additionalProperties: false, required: ['passed', 'failed'],
  properties: { passed: { type: 'integer' }, failed: { type: 'integer' }, results_ref: { type: 'string' } } }
const PatchCheck = { type: 'object', additionalProperties: false,
  required: ['repro_at_base', 'suite_at_base', 'repro_on_patch', 'suite_on_patch'],
  properties: { repro_at_base: Counts, suite_at_base: Counts, repro_on_patch: Counts, suite_on_patch: Counts, error: { type: 'string' } } }
const Intake = { type: 'object', additionalProperties: false, required: ['base_sha', 'known'],
  properties: { base_sha: { type: 'string' }, known: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } } }
const DeploymentC = { type: 'object', additionalProperties: false,
  required: ['project_id', 'env', 'url', 'port', 'ref', 'sha', 'worktree', 'started_at', 'status'],
  properties: { project_id: { type: 'string' }, env: { type: 'string' }, url: { type: 'string' }, port: { type: 'integer' },
    ref: { type: 'string' }, sha: { type: 'string' }, worktree: { type: 'string' }, app_dir: { type: 'string' }, pid: { type: 'integer' },
    started_at: { type: 'string' }, stopped_at: { type: 'string' }, log_ref: { type: 'string' }, status: { enum: ['running', 'stopped', 'failed'] } } }
const MitigationStep = { type: 'object', additionalProperties: false, required: ['ok', 'healthy'],
  properties: { ok: { type: 'boolean' }, healthy: { type: 'boolean' }, from_sha: { type: 'string' }, to_sha: { type: 'string' },
    evidence_ref: { type: 'string' }, deployment: DeploymentC, error: { type: 'string' } } }
const IncidentNarrative = { type: 'object', additionalProperties: false, required: ['summary', 'impact', 'timeline'],
  properties: { summary: { type: 'string', maxLength: 700 }, impact: { type: 'string', maxLength: 500 },
    lift_means: { type: 'string', maxLength: 500 },
    timeline: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['at', 'event'],
      properties: { at: { type: 'string' }, event: { type: 'string' } } } } } }
const Persisted = { type: 'object', additionalProperties: false, required: ['written', 'seen_ref'],
  properties: { written: { type: 'array', items: { type: 'string' } }, seen_ref: { type: 'string' }, error: { type: 'string' } } }

// =====================================================================
phase('Intake')
// Signal Collector is the caller's job (code, outside a run). Deduper is code here.
let signals = A.signals ?? []
if (!signals.length && A.signals_ref) {
  const read = await agent(`Read the JSON array of Signals at ${A.signals_ref} and return it verbatim under "signals". Copy, never interpret.`,
    { label: 'intake:signals', model: MODEL.cheap, ...AT('mechanical'),
      schema: { type: 'object', additionalProperties: false, required: ['signals'], properties: { signals: { type: 'array', items: { type: 'object' } } } } })
  signals = read?.signals ?? []
}
if (!signals.length) return { refused: true, reason: 'no signals: Maintain runs per signal, not on a schedule', provenance: stamp('maintain-triage', 'n/a', 'hotl') }

const intake = await agent(`Two reads, from the repo root. 1) git rev-parse --verify "${BASE_REF}^{commit}" → base_sha. If it fails, return base_sha="" and the
     stderr as error; NEVER substitute another ref (not HEAD, not a branch you think is equivalent) — an honest failure is the required answer.
     2) known = the JSON array of fingerprint strings at ${A.known_issues_ref ?? '(none given)'}${A.known_issues_ref ? ' (if the file does not exist, return [])' : ', which means return []'}.
     Also run: mkdir -p ${DIR}/repro ${DIR}/patches.`,
  { label: 'intake', model: MODEL.cheap, ...AT('mechanical'), schema: Intake })
if (!intake?.base_sha) return { refused: true, reason: `base ${BASE_REF} did not resolve: ${intake?.error ?? 'no result'}`, provenance: stamp('maintain-triage', 'n/a', 'hotl') }
const BASE = intake.base_sha
const known = new Set([...(A.known_issues ?? []), ...(intake.known ?? [])])

// Deduper (code, 0 tokens): collapse repeats inside the batch, drop what the known-issues set already carries.
const byFp = new Map()
let duplicates = 0
for (const s of signals) {
  if (known.has(s.fingerprint)) { duplicates++; continue }
  const prev = byFp.get(s.fingerprint)
  if (prev) {
    duplicates++
    prev.count += s.count ?? 1
    prev.surfaces = [...new Map([...(prev.surfaces ?? []), ...(s.surfaces ?? [])].map(x => [`${x.kind}:${x.ref}`, x])).values()]
    if (s.first_seen < prev.first_seen) prev.first_seen = s.first_seen
  } else byFp.set(s.fingerprint, { ...s })
}
const fresh = [...byFp.values()]
log(`${signals.length} signal(s) in, ${fresh.length} fresh, ${duplicates} duplicate/known; base ${BASE.slice(0, 8)}`)

// =====================================================================
// Mitigator (§4): code decides, a mechanical agent applies, once per run however many sev1s arrive. It never waits on
// diagnosis and diagnosis never waits on it; the only ordering that matters is mitigation before the page, and the page
// is a workflow boundary. A mitigation that cannot be applied is recorded as applied:false with the reason — never absent.
let mitigationP = null
const mitigatedFor = []
function mitigate(signal) {
  mitigatedFor.push(signal.id)
  if (mitigationP) return mitigationP
  const L = A.live
  const mk = (extra) => ({ id: `mit-${A.run_id}`, project_id: project, signal_ids: mitigatedFor, strategy: 'rollback',
    applied: false, reversible: true, ...extra, provenance: stamp('mitigator', MODEL.cheap, 'dark_factory') })
  if (!L?.env || !L?.port || !L?.app) {
    mitigationP = Promise.resolve(mk({ strategy: 'none', reversible: false,
      reason: 'args.live is absent or incomplete: this run had no deploy target to mitigate, so the page must be answered on an unmitigated sev1' }))
    return mitigationP
  }
  if (!L.rollback_to_ref) {
    mitigationP = Promise.resolve(mk({ strategy: 'none', reversible: false, env: L.env,
      reason: 'args.live.rollback_to_ref is missing: a rollback target is never guessed from the repo state' }))
    return mitigationP
  }
  mitigationP = (async () => {
    const ev = `${DIR}/mitigation.evidence.json`
    const r = await agent(`SEV1 MITIGATION — a deliberate, reversible rollback of a live environment. From the repo root, in this order; STOP at the first failure
         and report it in error rather than working around it:
         1) node substrate/deploy.js status --project ${project} --env ${L.env}. If it prints no record (or "nothing recorded"), return ok=false, healthy=false,
            error="${L.env} is not running: there is nothing to roll back" and stop. Otherwise copy its sha as from_sha.
         2) git rev-parse --verify "${L.rollback_to_ref}^{commit}" → to_sha. If it fails, return ok=false with the stderr as error and stop. NEVER substitute
            another ref (not HEAD, not a branch you think is equivalent): the target is ${L.rollback_to_ref} or nothing (c1v: a mechanical agent swapped an
            unresolvable ref for HEAD and the record lied about what was deployed).
         3) If to_sha equals from_sha, return ok=false, error="${L.env} already serves that sha: a rollback would change nothing" and stop.
         4) node substrate/deploy.js start --project ${project} --env ${L.env} --port ${L.port} --app ${L.app} --ref <to_sha> --now ${A.now}
         5) node substrate/deploy.js status --project ${project} --env ${L.env} → copy healthy, and the record (without alive/healthy) as deployment.
         6) Write {"from_sha":…,"to_sha":…,"ref":"${L.rollback_to_ref}","env":"${L.env}","status":<the step 5 output>} to ${ev} and return it as evidence_ref.
         Return ok=true only if steps 1-6 all succeeded.`,
      { label: 'mitigate:rollback', phase: 'Mitigate', model: MODEL.cheap, ...AT('mechanical'), schema: MitigationStep })
    if (!r?.ok) {
      log(`MITIGATION FAILED: ${r?.error ?? 'no result'}`)
      return mk({ env: L.env, to_ref: L.rollback_to_ref, reason: `rollback not applied: ${r?.error ?? 'the mitigation step returned nothing'}`,
        ...(r?.from_sha ? { from_sha: r.from_sha } : {}) })
    }
    log(`mitigated: ${L.env} rolled from ${String(r.from_sha).slice(0, 8)} to ${String(r.to_sha).slice(0, 8)} (${L.rollback_to_ref}), healthy=${r.healthy}`)
    return mk({ applied: true, applied_at: A.now, env: L.env, from_sha: r.from_sha, to_sha: r.to_sha, to_ref: L.rollback_to_ref,
      reason: `${L.env} served a sev1 defect; rolled back to ${L.rollback_to_ref} (${String(r.to_sha).slice(0, 8)}) while diagnosis ran${r.healthy ? '' : ' — WARNING: the env did not report healthy after the rollback'}`,
      lift_means: `${L.env} returns to ${String(r.from_sha).slice(0, 8)}, which carries the defect, before a fix has shipped`,
      evidence_ref: r.evidence_ref, ...(r.deployment ? { deployment: r.deployment } : {}) })
  })()
  return mitigationP
}

// =====================================================================
// One pipeline per signal: triage → (router, code) → repro ×≤cap → root cause → patch draft → verification.
// No barrier anywhere in Maintain (§4): a sev1 arriving second does not make the first signal's patch wait.
const triages = []
const patches = []
const parked = []
let noise = 0

const processed = (await pipeline(fresh, async (signal) => {
  const t0 = await agent(`Triage one Signal for the live product in ./${APP}/ of this repository. Read its payload at ${signal.payload_ref} — it is not inlined.
       Signal: ${JSON.stringify({ ...signal, surfaces: signal.surfaces ?? [] })}.
       Severity is about production, not about how interesting the defect is: sev1 = broken for users now / data or security exposed / SLO breached, something
       reversible must be done to production immediately; sev2 = wrong behavior a user can hit, production needs no action; sev3 = minor or latent; noise = not a
       defect in this product. Never derive severity from signal.source. surfaces: the narrowest repository-relative surfaces the payload justifies.`,
    { label: `triage:${signal.id}`, phase: 'Triage', model: MODEL.cheap, ...NEW('triage'), schema: TriageC })
  if (!t0) return null
  const triage = { ...t0, signal_id: signal.id, provenance: stamp('triage', MODEL.cheap, 'dark_factory') }
  triages.push(triage)
  log(`${signal.id}: ${triage.severity}/${triage.category} — ${triage.rationale.split('. ')[0]}`)

  // Severity Router: code. Noise is dropped and counted; a rising noise ratio is itself a health signal (§4).
  if (triage.severity === 'noise') { noise++; return { signal, triage, noise: true } }
  // sev1: mitigation starts now, in parallel with everything below. Not awaited here — diagnosis must not wait on it.
  if (triage.severity === 'sev1') mitigate(signal)

  // ---- Reproducer: up to the attempt cap. No Patch without a repro (§4). ----
  const wt = `${DIR}/repro/${signal.id}`
  const testRef = `${DIR}/repro/${signal.id}.test.js`
  const testInRepo = `test/repro-${signal.id}.test.js`
  let repro = null
  for (let n = 1; n <= MAX_REPRO; n++) {
    const r = await agent(`Reproduce one defect as a FAILING test. Attempt ${n} of ${MAX_REPRO}.
         1) git worktree add --detach ${wt} ${BASE} (skip if ${wt} already exists). The app is at ${wt}/${APP}/ — run npm ci there if node_modules is missing.
         2) Write a test at ${wt}/${APP}/${testInRepo} using the repo's existing runner and conventions (read the tests already there). It must fail
            against this code FOR THE REASON THE SIGNAL DESCRIBES, and its assertion must be the CORRECT behavior so it passes once the defect is fixed.
         3) Run it and confirm it fails. A test you did not run is not a repro. Copy the file to ${testRef} as well and return ${testRef} as failing_test_ref.
         Touch no implementation file: if you need to edit the app to make the test fail, that is not a repro — return cannot_repro.
         If you cannot make it fail, return status "cannot_repro" with notes saying exactly what you ran and observed. An honest miss is cheaper than a false repro.
         Signal: ${JSON.stringify(signal)}. Triage: ${JSON.stringify(triage)}. Payload is at ${signal.payload_ref}.
         ${n > 1 ? `Attempt ${n - 1} did not reproduce it. What it tried: ${JSON.stringify(repro?.notes ?? '')}. Try a different route, input shape, or sequence.` : ''}`,
      { label: `repro:${signal.id}:a${n}`, phase: 'Diagnose', model: MODEL.mid, ...NEW('reproducer'), schema: ReproC })
    if (!r) break
    repro = { ...r, signal_id: signal.id, attempts: n }
    if (r.status === 'reproduced' && r.failing_test_ref) break
  }
  if (!repro || repro.status !== 'reproduced' || !repro.failing_test_ref) {
    // Holding set (§4): two honest misses park the signal. It is counted, never silently dropped, and never patched blind.
    parked.push({ signal_id: signal.id, severity: triage.severity, repro: repro ?? { status: 'cannot_repro', attempts: MAX_REPRO, notes: 'the reproducer returned nothing' } })
    log(`${signal.id}: parked after ${repro?.attempts ?? MAX_REPRO} repro attempt(s)`)
    return { signal, triage, parkedHere: true }
  }

  // ---- Root Cause Analyst ----
  const cause = await agent(`Find the root cause of one reproduced defect. Repo root; the app is at ./${APP}/ and a worktree at ${BASE.slice(0, 12)} is at ${wt}.
       The failing test is at ${repro.failing_test_ref}. git log / git blame / git show on the suspected location are yours.
       One cause, one location (path:line). The hypothesis is the mechanism — what the code does and why it produces the observed output — not a fix and not a list.
       surfaces = the narrowest surfaces a fix must touch; the Patch Drafter will be held to them. suspect_commit only if the history actually points at one.
       Triage: ${JSON.stringify(triage)}. Repro: ${JSON.stringify({ steps: repro.steps, observed: repro.observed, expected: repro.expected })}.`,
    { label: `rca:${signal.id}`, phase: 'Diagnose', model: MODEL.mid, ...NEW('root-cause'), schema: CauseC })
  if (!cause) { parked.push({ signal_id: signal.id, severity: triage.severity, repro, reason: 'root cause analysis returned nothing' }); return { signal, triage, parkedHere: true } }
  log(`${signal.id}: cause at ${cause.location} (confidence ${cause.confidence})`)

  // ---- Patch Drafter ----
  const patchId = `patch-${signal.id}`
  const pwt = `${DIR}/patches/${signal.id}`
  const branch = `patch/${signal.id}`
  const diffRef = `${ART}/diffs/${patchId}.patch`
  const cs = await agent(`Draft the smallest patch that fixes one cause, with its regression test.
       1) git worktree add -b ${branch} ${pwt} ${BASE} (if ${pwt} exists, reuse it; if the branch exists, check it out there). App at ${pwt}/${APP}/ — npm ci if node_modules is missing.
       2) Copy the repro test ${repro.failing_test_ref} into ${pwt}/${APP}/${testInRepo} UNCHANGED. Never relax, skip or rewrite its assertion to make it pass.
       3) Make the smallest change inside ${JSON.stringify(cause.surfaces ?? triage.surfaces)} that makes it pass. No refactoring, no cleanup, no adjacent improvements.
       4) Run the app's full suite (npm test in ${pwt}/${APP}/). Report what you saw; never hide a failure you introduced.
       5) Commit the fix and the test together on ${branch}. Write the cumulative diff vs ${BASE} (git diff ${BASE}...HEAD, run inside the worktree) to ${diffRef}
          and return it as diff_ref. id="${patchId}-cs", worktree="${pwt}", branch="${branch}", base_commit="${BASE}", revision 0, touched_surfaces from the diff.
       If the cause is wrong, change nothing and set notes to "DISPUTE: <what you ran and what it showed>".
       Cause: ${JSON.stringify(cause)}. Repro: ${JSON.stringify({ steps: repro.steps, observed: repro.observed, expected: repro.expected })}.`,
    { label: `draft:${signal.id}`, phase: 'Diagnose', model: MODEL.mid, ...NEW('patch-drafter'), schema: ChangeSetC })
  if (!cs || cs.notes?.startsWith('DISPUTE:')) {
    parked.push({ signal_id: signal.id, severity: triage.severity, repro, reason: cs?.notes ?? 'the patch drafter returned nothing' })
    log(`${signal.id}: no patch — ${cs?.notes ?? 'drafter returned nothing'}`)
    return { signal, triage, parkedHere: true }
  }

  // ---- Verification: measurements by a mechanical agent, verdict derived here (never declared by an agent) ----
  const check = await agent(`Measure a patch. Run commands only; never edit a file, never fix a failure you find. If a command cannot run, report zeros for it and
       put the error in error — never substitute a different command.
       1) In ${wt}/${APP}/ (the BASE worktree, which has the repro test but not the fix): run only ${testInRepo} with the repo's runner and report passed/failed as
          repro_at_base. It is EXPECTED to fail here.
       2) In ${wt}/${APP}/: run the full suite (npm test) and report passed/failed as suite_at_base.
       3) In ${cs.worktree}/${APP}/ (the patch worktree): run only ${testInRepo} → repro_on_patch.
       4) In ${cs.worktree}/${APP}/: run the full suite (npm test) → suite_on_patch, writing the output tail and counts to ${DIR}/${patchId}.suite.json and
          returning that path as its results_ref.`,
    { label: `verify:${signal.id}`, phase: 'Verify', model: MODEL.cheap, ...AT('mechanical'), schema: PatchCheck })
  const z = { passed: 0, failed: 0 }
  // PatchVerification allows results_ref on the suite measurement only; the script strips what the contract does not carry.
  const pick = (o) => (o ? { passed: o.passed, failed: o.failed } : z)
  const c = { repro_at_base: pick(check?.repro_at_base), suite_at_base: pick(check?.suite_at_base), repro_on_patch: pick(check?.repro_on_patch),
              suite_on_patch: check?.suite_on_patch ? { passed: check.suite_on_patch.passed, failed: check.suite_on_patch.failed, ...(check.suite_on_patch.results_ref ? { results_ref: check.suite_on_patch.results_ref } : {}) } : z }
  const checks = [
    { name: 'repro_fails_at_base', status: c.repro_at_base.failed >= 1 ? 'pass' : 'fail',
      detail: `the regression test at ${BASE.slice(0, 8)}: ${c.repro_at_base.passed} passed, ${c.repro_at_base.failed} failed — it must fail here or the patch proves nothing` },
    { name: 'repro_passes_on_patch', status: c.repro_on_patch.failed === 0 && c.repro_on_patch.passed >= 1 ? 'pass' : 'fail',
      detail: `the same test on ${branch}: ${c.repro_on_patch.passed} passed, ${c.repro_on_patch.failed} failed` },
    { name: 'suite_green_on_patch', status: c.suite_on_patch.failed === 0 && c.suite_on_patch.passed > 0 ? 'pass' : 'fail',
      detail: `full suite on ${branch}: ${c.suite_on_patch.passed} passed, ${c.suite_on_patch.failed} failed (base: ${c.suite_at_base.passed} passed, ${c.suite_at_base.failed} failed)` },
    { name: 'suite_not_shrunk', status: c.suite_on_patch.passed >= c.suite_at_base.passed + 1 ? 'pass' : 'fail',
      detail: `${c.suite_on_patch.passed} passing on the patch vs ${c.suite_at_base.passed} at base; the regression test must be one more, not one instead` },
  ]
  if (check?.error) checks.push({ name: 'measurements_complete', status: 'fail', detail: check.error })
  const verified = checks.every(k => k.status === 'pass')
  log(`${signal.id}: patch ${verified ? 'VERIFIED' : 'NOT verified'} — ${checks.filter(k => k.status === 'fail').map(k => k.name).join(', ') || 'all four checks pass'}`)

  const mit = triage.severity === 'sev1' ? await mitigationP : null
  const patch = {
    id: patchId,
    signal_ids: [signal.id],
    severity: triage.severity,
    // Provisional: §3's Patch Classifier re-derives urgency from the conflict surfaces and the sev1 page decision and may override it.
    urgency: triage.severity === 'sev1' ? 'hotfix' : 'routine',
    repro,
    cause,
    change_set: { ...cs, notes: undefined, provenance: stamp('patch_drafter', MODEL.mid, 'hotl') },
    verification: { verified, repro_at_base: c.repro_at_base, repro_on_patch: c.repro_on_patch, suite_on_patch: c.suite_on_patch, checks },
    ...(mit?.applied ? { mitigation_id: mit.id } : {}),
    provenance: stamp('patch_drafter', MODEL.mid, 'hotl'),
  }
  patches.push(patch)
  return { signal, triage, patch }
})).filter(Boolean)

// =====================================================================
phase('Incident')
// Incident Commander. Its real inputs are the sev1 triages AND the mitigation result — the page cannot say what was already
// done without the second one (§4's table omits that edge; it is real). Options are set by code from what actually landed.
const sev1 = processed.filter(p => p.triage.severity === 'sev1')
let mitigation = null, incident = null
if (sev1.length) {
  mitigation = await mitigationP
  const sev1Patches = sev1.filter(p => p.patch).map(p => p.patch)
  const narrative = await agent(`Write the sev1 page a single human reads on their phone. Plain sentences, no ids in the prose, no reassurance.
       summary: what is broken and what was already done to production. impact: who is affected and how, from the signals only.
       lift_means: what changes if the human lifts the mitigation — be concrete about what returns to production.
       timeline: the ordered events you can justify from the data below, each with its timestamp (they all carry ${A.now}; that is the run's clock).
       Signals: ${JSON.stringify(sev1.map(p => ({ id: p.signal.id, source: p.signal.source, count: p.signal.count, first_seen: p.signal.first_seen })))}.
       Triages: ${JSON.stringify(sev1.map(p => p.triage))}.
       Mitigation (this already happened, before anyone was paged): ${JSON.stringify(mitigation)}.
       Patches drafted so far: ${JSON.stringify(sev1Patches.map(p => ({ id: p.id, cause: p.cause.location, verified: p.verification.verified })))}.
       Parked signals: ${JSON.stringify(parked.filter(x => x.severity === 'sev1'))}.`,
    { label: 'incident', phase: 'Incident', model: MODEL.mid, schema: IncidentNarrative })
  // Code, not the agent: a failed mitigation never offers keep/lift. An unmitigated sev1 is acknowledged by name.
  const page_options = mitigation.applied ? ['keep_mitigation', 'lift_mitigation'] : ['direct_drive', 'accept_unmitigated']
  incident = {
    id: `inc-${A.run_id}`,
    project_id: project,
    severity: 'sev1',
    signal_ids: sev1.map(p => p.signal.id),
    opened_at: A.now,
    status: mitigation.applied ? 'mitigated' : 'unmitigated',
    summary: narrative?.summary ?? `SEV1 on ${project}: the page narrative agent failed; read the triages and the mitigation record directly.`,
    impact: narrative?.impact ?? 'unknown: the narrative agent failed',
    mitigation,
    timeline: narrative?.timeline ?? [{ at: A.now, event: 'sev1 classified; see the mitigation record' }],
    page_options,
    patch_ids: sev1Patches.map(p => p.id),
    provenance: stamp('incident_commander', MODEL.mid, 'hitl'),
  }
  log(`SEV1: incident ${incident.id}, status ${incident.status}, page options ${page_options.join('|')}`)
} else if (mitigationP) {
  mitigation = await mitigationP   // cannot happen: only a sev1 starts one. Awaited so a started mitigation is never orphaned.
}

// =====================================================================
phase('Health')
// Health Aggregator: code. Every number has an input; the two that Maintain structurally cannot measure say so rather than guessing.
const counts = { sev1: 0, sev2: 0, sev3: 0, noise: 0 }
for (const t of triages) counts[t.severity] = (counts[t.severity] ?? 0) + 1
const drafted = patches.length
const prevDefects = A.health?.prev?.defects
const defects = counts.sev1 + counts.sev2 + counts.sev3
const trend = counts.sev1 > 0 ? 'degrading'
  : prevDefects == null ? 'stable'
  : defects > prevDefects ? 'degrading' : defects < prevDefects ? 'improving' : 'stable'
const trendBasis = counts.sev1 > 0 ? `${counts.sev1} sev1 in this period`
  : prevDefects == null ? `no prior period supplied: ${defects} defect signal(s) this period, asserted as stable from one period, which is not yet a trend`
  : `${defects} defect signal(s) vs ${prevDefects} in the previous period`
const givenRatio = A.health?.maintain_ratio
const improveBacklog = A.health?.improve_backlog
const maintainRatio = givenRatio != null ? givenRatio
  : improveBacklog != null ? (drafted + improveBacklog > 0 ? drafted / (drafted + improveBacklog) : 0)
  : (drafted > 0 ? 1 : 0)
const ratioSource = givenRatio != null || improveBacklog != null ? 'measured' : 'provisional'
if (ratioSource === 'provisional') log(`maintain_ratio is provisional (${maintainRatio}): Maintain sees no Build capacity and no improve backlog — Build re-entry measures it`)
const health = {
  project_id: project,
  period: A.health?.period ?? { from: A.now, to: A.now },
  slo: A.health?.slo ?? [],
  signals_by_severity: counts,
  patches_shipped: 0,            // Build's number, not Maintain's: nothing here has shipped.
  patches_drafted: drafted,
  incidents: incident ? 1 : 0,
  mitigations: mitigation?.applied ? 1 : 0,
  noise_ratio: triages.length ? counts.noise / triages.length : 0,
  parked_signals: parked.map(p => p.signal_id),
  maintain_ratio: maintainRatio,
  maintain_ratio_source: ratioSource,
  trend,
  trend_basis: trendBasis,
  provenance: stamp('health_aggregator', 'n/a', 'dark_factory'),
}

// Persist: the seen-set (§9.9, keyed on Signal.fingerprint — parked and noise included, or the loop rediscovers them) and
// every artifact this run produced, already stamped. The script hands the agent finished JSON; the agent only writes it.
const seenRef = A.known_issues_ref ?? `${ART}/maintain/known-issues.json`
const persisted = await agent(`Write files, from the repo root. mkdir -p as needed. Write each JSON exactly as given, pretty-printed; change no value.
     1) ${DIR}/health.json = ${JSON.stringify(health)}
     2) ${DIR}/patches.json = ${JSON.stringify(patches)}  — and each element separately to ${DIR}/patches/<element id>.json
     ${incident ? `3) ${DIR}/incident.json = ${JSON.stringify(incident)}` : '3) (no incident this run)'}
     ${mitigation ? `4) ${DIR}/mitigation.json = ${JSON.stringify(mitigation)}` : '4) (no mitigation this run)'}
     5) ${seenRef} = the union of the JSON array already there (or [] if absent) with ${JSON.stringify(fresh.map(s => s.fingerprint))}, sorted, no duplicates.
     Then: node substrate/validator.js HealthReport ${DIR}/health.json, and node substrate/validator.js Patch <each patch file>, and
     ${incident ? `node substrate/validator.js IncidentRecord ${DIR}/incident.json, and node substrate/validator.js Mitigation ${DIR}/mitigation.json.` : 'nothing else.'}
     Return every path you wrote, and put any validator failure verbatim in error — never edit an artifact to make a validator pass.`,
  { label: 'persist', model: MODEL.cheap, ...AT('mechanical'), schema: Persisted })
if (persisted?.error) log(`persist reported: ${persisted.error}`)

const verifiedPatches = patches.filter(p => p.verification.verified)
log(`${verifiedPatches.length}/${patches.length} patch(es) verified; ${parked.length} parked; ${counts.noise} noise; ${duplicates} duplicate/known`)

return {
  project_id: project,
  patches,
  triages,
  parked,
  dropped: { duplicates, noise: counts.noise },
  health,
  ...(mitigation ? { mitigation } : {}),
  ...(incident ? { incident } : {}),
  // The page is opened by the main session from incident.json; the mitigation evidence file already exists on disk.
  ...(incident ? { gate: { gate: 'sev1_page', options: incident.page_options, next: 'build-reentry', payload_ref: `${DIR}/incident.json` } } : {}),
  refs: { dir: DIR, health: `${DIR}/health.json`, patches: `${DIR}/patches.json`, seen: persisted?.seen_ref ?? seenRef,
    ...(mitigation?.evidence_ref ? { mitigation_evidence: mitigation.evidence_ref } : {}) },
  base_sha: BASE,
  provenance: stamp('maintain-triage', 'n/a', 'hotl'),
}
