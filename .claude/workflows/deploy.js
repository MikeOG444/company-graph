export const meta = {
  name: 'deploy',
  description: 'Launch, second stretch (OPERATING_MODEL §7): the HC approval → canary deploy beside the baseline → N-round watch (code verdict per round) → promote or auto-rollback → LaunchRecord.',
  phases: [
    { title: 'Approval', detail: 'mechanical: the launch_approval gate record is the approval; veto → WorkItem, no deploy' },
    { title: 'Deploy', detail: 'baseline on prod ∥ candidate on canary (substrate/deploy.js)' },
    { title: 'Watch', detail: 'rounds of canary-vs-baseline probes; the script derives healthy / regressed / inconclusive' },
    { title: 'Promote or roll back', detail: 'healthy → promote canary sha to prod; anything else → stop canary, prod untouched' },
    { title: 'Record', detail: 'code: LaunchRecord' },
  ],
}

// args: { gate: { gate_id }, package: ReviewPackage (the object the human approved; one page, inlined), package_ref?,
//         envs: Workspace.envs (needs prod and canary URLs on 127.0.0.1), repo, run_id, now,
//         baseline_ref?: git ref to START prod from when nothing is running there (first launch). When prod is already
//                        running, its own sha is the baseline and this is ignored. No default: an absent baseline with
//                        nothing running is a refusal, never "deploy without a comparison".
//         watch?: { rounds (3), round_seconds (60), thresholds: { error_rate_delta (0.02), p95_factor (3), p95_floor_ms (25), min_requests (20) } }
//         seed_regression?: string — TEST ONLY: a mutation a mechanical agent applies to the canary worktree before it
//                        starts (the rollback drill in HANDOFF Phase 3). Recorded on the LaunchRecord so it can never
//                        be mistaken for a real rollback. }
// returns: LaunchRecord (contracts.schema.json); on veto { vetoed: true, work_item: WorkItem(source=launch_veto) };
//          on a refused precondition { refused: true, reason }.
//
// Human touchpoints: none inside. Auto-rollback is code. A rolled-back launch is reported in chat by the main session;
// the next human action, if any, is a new Build, not a gate.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
const pkg = A.package
const project = pkg.project_id
const rc = pkg.release_candidate_id
const W = { rounds: 3, round_seconds: 60, ...(A.watch ?? {}) }
const T = { error_rate_delta: 0.02, p95_factor: 3, p95_floor_ms: 25, min_requests: 20, ...(A.watch?.thresholds ?? {}) }
const port = (url) => { const m = /:(\d+)\/?$/.exec(String(url)); return m ? Number(m[1]) : null }
const PROD = { url: A.envs?.prod, port: port(A.envs?.prod) }
const CANARY = { url: A.envs?.canary, port: port(A.envs?.canary) }
const CLI = 'node substrate/deploy.js'
const watchDir = `.artifacts/deploy/${project}/watch`

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const GateCheck = { type: 'object', additionalProperties: false, required: ['found', 'status', 'option', 'gate', 'payload_rc', 'decided_by', 'decided_at', 'note'],
  properties: { found: { type: 'boolean' }, status: { type: 'string' }, option: { type: 'string' }, gate: { type: 'string' },
    payload_rc: { type: 'string', description: 'payload.release_candidate_id or ""' }, decided_by: { type: 'string' }, decided_at: { type: 'string' }, note: { type: 'string' } } }
const Deployment = { type: 'object', additionalProperties: false,
  required: ['project_id', 'env', 'url', 'port', 'ref', 'sha', 'worktree', 'started_at', 'status'],
  properties: { project_id: { type: 'string' }, env: { type: 'string' }, url: { type: 'string' }, port: { type: 'integer' }, ref: { type: 'string' },
    sha: { type: 'string' }, worktree: { type: 'string' }, app_dir: { type: 'string' }, pid: { type: 'integer' }, started_at: { type: 'string' },
    stopped_at: { type: 'string' }, log_ref: { type: 'string' }, status: { enum: ['running', 'stopped', 'failed'] } } }
const DeployStep = { type: 'object', additionalProperties: false, required: ['ok', 'healthy'],
  properties: { ok: { type: 'boolean' }, healthy: { type: 'boolean' }, deployment: Deployment, error: { type: 'string' }, mutated_sha: { type: 'string' } } }
const Metrics = { type: 'object', additionalProperties: false, required: ['requests', 'errors', 'unreachable', 'error_rate', 'p50_ms', 'p95_ms'],
  properties: { requests: { type: 'integer' }, errors: { type: 'integer' }, unreachable: { type: 'integer' }, error_rate: { type: 'number' },
    p50_ms: { type: ['number', 'null'] }, p95_ms: { type: ['number', 'null'] } } }
const Probe = { type: 'object', additionalProperties: false, required: ['ok', 'raw_ref'],
  properties: { ok: { type: 'boolean' }, raw_ref: { type: 'string' }, canary: Metrics, baseline: Metrics, error: { type: 'string' } } }

const refuse = (reason) => { log(`refused: ${reason}`); return { refused: true, reason, release_candidate_id: rc, provenance: stamp('deploy', 'n/a', 'hitl') } }

// =====================================================================
phase('Approval')
if (!A.gate?.gate_id) return refuse('no gate_id: the launch_approval gate record is the approval')
if (!PROD.port || !CANARY.port) return refuse(`envs must carry prod and canary URLs with ports; got ${JSON.stringify(A.envs)}`)
const gate = await agent(`Run from the repo root: node substrate/gates.js show ${A.gate.gate_id}. Report found, status, decision.option ("" if none), gate,
                          payload.release_candidate_id ("" if absent), decision.decided_by, decision.decided_at, decision.note ("" if none). Copy, never interpret.`,
  { label: 'gate:launch_approval', model: MODEL.cheap, ...AT('mechanical'), schema: GateCheck })
if (!gate?.found) return refuse(`gate ${A.gate.gate_id} not found`)
if (gate.gate !== 'launch_approval' || gate.status !== 'decided') return refuse(`gate ${A.gate.gate_id} is ${gate.gate}/${gate.status}, not launch_approval/decided`)
if (gate.payload_rc !== rc) return refuse(`gate ${A.gate.gate_id} decided ${gate.payload_rc}, not ${rc}`)
if (gate.option === 'veto') {
  // The veto returns the candidate to Build with the HC's reason as a WorkItem (§7). Code; no deploy.
  log(`vetoed at ${A.gate.gate_id}: ${gate.note || '(no note)'}`)
  return { vetoed: true, release_candidate_id: rc,
    work_item: { id: `wi-veto-${rc}`, project_id: project, source: 'launch_veto', title: `Launch veto on ${rc}`,
      intent: gate.note || `The HC vetoed ${rc} at gate ${A.gate.gate_id} without a note; ask before rebuilding.`, priority: 1, deferred_iterations: 0,
      provenance: { node: 'approval_gate', executor: 'human_client', method: 'hitl', run_id: A.run_id, created_at: gate.decided_at || A.now } },
    provenance: stamp('deploy', 'n/a', 'hitl') }
}
if (gate.option === 'approve' && !pkg.preflight.go) return refuse('approve on a no-go package: the package offered veto or approve_override only')
if (gate.option === 'approve_override' && !gate.note) return refuse('approve_override needs a note; the reason goes on the LaunchRecord')
if (gate.option !== 'approve' && gate.option !== 'approve_override') return refuse(`unknown decision "${gate.option}"`)
if (!pkg.artifact_sha) return refuse('package has no artifact_sha: preflight could not pin a commit, nothing to deploy')
log(`${gate.option} by ${gate.decided_by} at ${gate.decided_at}${gate.note ? ` — ${gate.note}` : ''}`)

// =====================================================================
phase('Deploy')
// Baseline and candidate are independent processes on independent ports: one line each, joined only because the watch compares them.
const [base, can] = await parallel([
  () => agent(`Baseline. From the repo root: ${CLI} status --project ${project} --env prod. If it prints a record with alive=true and healthy=true,
       return ok=true, healthy=true and that record (drop the alive/healthy fields) as deployment.
       Otherwise${A.baseline_ref ? `: ${CLI} start --project ${project} --env prod --port ${PROD.port} --app ${A.repo} --ref ${A.baseline_ref} --now ${A.now}; return ok=true,
       healthy=true and the printed record as deployment; if it exits non-zero, ok=false with the error text.` : ` return ok=false, healthy=false, error="prod not running and no baseline_ref".`}`,
    { label: 'deploy:baseline', model: MODEL.cheap, ...AT('mechanical'), schema: DeployStep }),
  () => agent(`Candidate. From the repo root: 1) ${CLI} checkout --project ${project} --env canary --ref ${pkg.artifact_sha} --app ${A.repo}.
       ${A.seed_regression ? `2) SEEDED REGRESSION DRILL, on purpose: in the worktree it printed, apply exactly this change to the app under ${A.repo}/ and commit it there
       with the message "tidy handler" (git -c user.email=drill@plant -c user.name=drill commit -am ...): ${A.seed_regression}. Return the new HEAD sha as mutated_sha.` : ''}
       3) ${CLI} start --project ${project} --env canary --port ${CANARY.port} --app ${A.repo} --now ${A.now}. Return ok=true, healthy=true and the printed record as
       deployment; if start exits non-zero, ok=false, healthy=false, error = its stderr (the health wait failed or the port is taken).`,
    { label: 'deploy:canary', model: MODEL.cheap, ...AT('mechanical'), schema: DeployStep }),
])
if (!base?.ok || !base.deployment) return refuse(`no baseline: ${base?.error ?? 'baseline step failed'}`)
const baseline = base.deployment
log(`baseline prod ${baseline.sha.slice(0, 8)} on ${baseline.url}; canary ${can?.ok ? `${can.deployment.sha.slice(0, 8)} on ${can.deployment.url}` : `FAILED: ${can?.error ?? 'no result'}`}`)
if (A.seed_regression) log(`DRILL: canary carries a seeded regression (${can?.mutated_sha?.slice(0, 8) ?? '?'}), not ${pkg.artifact_sha.slice(0, 8)}`)

// =====================================================================
phase('Watch')
// The verdict is derived here from the numbers; the probe agent only runs the command and copies the summary.
function judge(m) {
  const reasons = []
  if (!m.canary || !m.baseline) return { verdict: 'inconclusive', reasons: ['probe returned no metrics for one side'] }
  if (m.canary.requests < T.min_requests || m.baseline.requests < T.min_requests) reasons.push(`too few probes (canary ${m.canary.requests}, baseline ${m.baseline.requests}, need ${T.min_requests})`)
  if (m.baseline.unreachable === m.baseline.requests) reasons.push('baseline unreachable for the whole round: nothing to compare against')
  if (reasons.length) return { verdict: 'inconclusive', reasons }
  if (m.canary.error_rate > m.baseline.error_rate + T.error_rate_delta) reasons.push(`error rate ${m.canary.error_rate} vs baseline ${m.baseline.error_rate} (+${T.error_rate_delta} allowed)`)
  if (m.canary.p95_ms !== null && m.baseline.p95_ms !== null && m.canary.p95_ms > Math.max(m.baseline.p95_ms * T.p95_factor, m.baseline.p95_ms + T.p95_floor_ms))
    reasons.push(`p95 ${m.canary.p95_ms}ms vs baseline ${m.baseline.p95_ms}ms (×${T.p95_factor} or +${T.p95_floor_ms}ms allowed)`)
  return { verdict: reasons.length ? 'regressed' : 'healthy', reasons }
}
const rounds = []
let verdict = 'healthy', reasons = []
if (!can?.ok || !can.deployment) { verdict = 'regressed'; reasons = [`canary failed to start: ${can?.error ?? 'no result'}`] }
else {
  for (let r = 1; r <= W.rounds; r++) {
    const raw = `${watchDir}/${rc}.r${r}.jsonl`
    const probe = await agent(`Post-launch watch, round ${r}/${W.rounds}. From the repo root run (it takes ${W.round_seconds}s; give the Bash tool a timeout of ${(W.round_seconds + 60) * 1000} ms):
         ${CLI} probe --project ${project} --canary canary --baseline prod --seconds ${W.round_seconds} --out ${raw}
         Return ok=true, raw_ref="${raw}", and copy the printed summary's canary and baseline objects WITHOUT their by_route field
         (requests, errors, unreachable, error_rate, p50_ms, p95_ms). If the command fails, ok=false with the error text.`,
      { label: `watch:r${r}`, model: MODEL.cheap, ...AT('mechanical'), schema: Probe })
    const j = probe?.ok ? judge(probe) : { verdict: 'inconclusive', reasons: [`probe failed: ${probe?.error ?? 'no result'}`] }
    rounds.push({ round: r, canary: probe?.canary ?? { requests: 0, errors: 0, unreachable: 0, error_rate: 0, p50_ms: null, p95_ms: null },
                  baseline: probe?.baseline ?? { requests: 0, errors: 0, unreachable: 0, error_rate: 0, p50_ms: null, p95_ms: null },
                  verdict: j.verdict, reasons: j.reasons, ...(probe?.raw_ref ? { raw_ref: probe.raw_ref } : {}) })
    log(`watch r${r}: ${j.verdict}${j.reasons.length ? ` — ${j.reasons.join('; ')}` : ` (canary err ${probe.canary.error_rate}, p95 ${probe.canary.p95_ms}ms; baseline err ${probe.baseline.error_rate}, p95 ${probe.baseline.p95_ms}ms)`}`)
    if (j.verdict !== 'healthy') { verdict = j.verdict; reasons = j.reasons; break }
  }
}
const watch = { release_candidate_id: rc, project_id: project,
  window: { rounds_planned: W.rounds, rounds_run: rounds.length, round_seconds: W.round_seconds }, thresholds: T, rounds, verdict, reasons,
  provenance: stamp('post_launch_watch', 'n/a', 'dark_factory') }

// =====================================================================
phase('Promote or roll back')
let prod, rolledBack = false
if (verdict === 'healthy') {
  const p = await agent(`Promote. From the repo root: ${CLI} promote --project ${project} --from canary --to prod --port ${PROD.port} --app ${A.repo} --now ${A.now}.
       Then ${CLI} status --project ${project} --env prod. Return ok=true if promote exited 0, healthy from the status output, and the prod record
       (without alive/healthy) as deployment. On failure ok=false with the error text.`,
    { label: 'promote', model: MODEL.cheap, ...AT('mechanical'), schema: DeployStep })
  if (!p?.ok || !p.healthy || !p.deployment) {
    // Promotion failed: prod may be down. The rollback edge is the baseline sha back on the prod port.
    rolledBack = true; reasons = [...reasons, `promotion failed: ${p?.error ?? 'prod unhealthy after promote'}`]
    log(`promotion failed; restoring baseline ${baseline.sha.slice(0, 8)} on prod`)
    const back = await agent(`Rollback. From the repo root: ${CLI} start --project ${project} --env prod --port ${PROD.port} --app ${A.repo} --ref ${baseline.sha} --now ${A.now};
         then ${CLI} stop --project ${project} --env canary. Return ok, healthy (from the start output being a running record) and the prod record as deployment.`,
      { label: 'rollback', model: MODEL.cheap, ...AT('mechanical'), schema: DeployStep })
    prod = back?.deployment ?? baseline
  } else prod = p.deployment
} else {
  rolledBack = true
  const back = await agent(`Rollback. From the repo root: ${CLI} stop --project ${project} --env canary (fine if it prints "nothing recorded").
       Then ${CLI} status --project ${project} --env prod. Return ok=true, healthy from the status output, and the prod record (without alive/healthy) as deployment.`,
    { label: 'rollback', model: MODEL.cheap, ...AT('mechanical'), schema: DeployStep })
  prod = back?.deployment ?? baseline
  if (back && !back.healthy) reasons = [...reasons, 'prod reported unhealthy after rollback']
  log(`rolled back: ${reasons.join('; ')}; prod stays at ${prod.sha.slice(0, 8)}`)
}

// =====================================================================
phase('Record')
return {
  release_candidate_id: rc,
  project_id: project,
  approved_by: gate.decided_by || 'human_client',
  approved_at: gate.decided_at || A.now,
  approval_gate_id: A.gate.gate_id,
  ...(gate.option === 'approve_override' ? { override_reason: gate.note } : {}),
  deployed_at: can?.deployment?.started_at ?? A.now,
  strategy: 'canary',
  watch_result: rolledBack ? 'auto_rolled_back' : 'healthy',
  ...(rolledBack ? { rolled_back_at: A.now, rollback_reasons: reasons } : {}),
  artifact_ref: pkg.artifact_ref,
  artifact_sha: pkg.artifact_sha,
  baseline_ref: baseline.ref,
  baseline_sha: baseline.sha,
  live_url: prod.url,
  live_sha: prod.sha,
  ...(can?.deployment ? { canary: can.deployment } : {}),
  prod,
  watch,
  ...(A.seed_regression ? { seeded_regression: A.seed_regression } : {}),
  ...(pkg.release_notes_ref ? { release_notes_ref: pkg.release_notes_ref } : {}),
  ...(A.package_ref ? { review_package_ref: A.package_ref } : {}),
  provenance: stamp('deploy', 'n/a', 'hitl'),
}
