export const meta = {
  name: 'launch',
  description: 'Launch, first stretch (OPERATING_MODEL §7): Preflight ∥ Release Notes → Review Package. Ends at Launch approval: the HC approves or vetoes in chat, then /deploy.',
  phases: [
    { title: 'Preflight ∥ Notes', detail: 'bundle digest → (artifact re-verified ∥ gate queue read) ∥ release notes from the specs' },
    { title: 'Package', detail: 'code: go/no-go from the checks, one page for the HC' },
  ],
}

// args: { bundle_ref, spec_refs: [path], repo, run_id, now, base_ref? (default "main"), project_id? }
//   bundle_ref: path to the EvidenceBundle JSON — either a bare bundle or a ledger run file (ledger/runs/<run>-build-implement.json,
//               whose .result is the bundle). Bundles are large (every panel round); they cross this edge by ref and a mechanical
//               agent returns only the digest Preflight needs.
//   spec_refs:  full Spec JSON per shipped spec. EvidenceBundle.specs carries ids only; the Release Notes Writer needs the goals.
//   repo:       app directory in this repository (e.g. "toy"); Preflight re-runs its suite on the pinned artifact.
// returns: ReviewPackage (contracts.schema.json). The main session opens the launch_approval gate with it:
//   gates open --gate launch_approval --run <run_id> --workflow launch --options <package.options> --payload <saved return> --next deploy
//
// Human touchpoints: none inside. The gate is the boundary; /deploy takes the decision.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
const BASE = A.base_ref ?? 'main'

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const Digest = { type: 'object', additionalProperties: false,
  required: ['release_candidate_id', 'project_id', 'iteration', 'artifact_ref', 'specs', 'suite', 'escalations', 'starved_items', 'panels', 'migrations_declared', 'migrations'],
  properties: { release_candidate_id: { type: 'string' }, project_id: { type: 'string' }, iteration: { type: 'integer' }, artifact_ref: { type: 'string' },
    specs: { type: 'array', items: { type: 'string' } },
    suite: { type: 'object', additionalProperties: false, required: ['passed', 'failed', 'results_ref'], properties: { passed: { type: 'integer' }, failed: { type: 'integer' }, results_ref: { type: 'string' } } },
    escalations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['task_id', 'reason'], properties: { task_id: { type: 'string' }, reason: { type: 'string' } } } },
    starved_items: { type: 'array', items: { type: 'string' } },
    panels: { type: 'object', additionalProperties: false, required: ['change_sets', 'final_pass', 'final_fail', 'vetoes', 'rounds'],
      properties: { change_sets: { type: 'integer' }, final_pass: { type: 'integer' }, final_fail: { type: 'integer' }, vetoes: { type: 'integer' }, rounds: { type: 'integer' } } },
    migrations_declared: { type: 'boolean' },
    migrations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'reversible'], properties: { id: { type: 'string' }, reversible: { type: 'boolean' } } } } } }
const ArtifactCheck = { type: 'object', additionalProperties: false, required: ['exists', 'sha', 'passed', 'failed', 'results_ref', 'migration_files', 'files_changed'],
  properties: { exists: { type: 'boolean' }, sha: { type: 'string' }, passed: { type: 'integer' }, failed: { type: 'integer' }, results_ref: { type: 'string' },
    migration_files: { type: 'array', items: { type: 'string' } }, files_changed: { type: 'integer' }, notes: { type: 'string' } } }
const GateQueue = { type: 'object', additionalProperties: false, required: ['open'],
  properties: { open: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'gate', 'project_id'],
    properties: { id: { type: 'string' }, gate: { type: 'string' }, project_id: { type: 'string' } } } } } }
const Notes = { type: 'object', additionalProperties: false, required: ['release_notes_ref', 'summary', 'items'],
  properties: { release_notes_ref: { type: 'string' }, summary: { type: 'string', maxLength: 900 },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['spec_id', 'headline'], properties: { spec_id: { type: 'string' }, headline: { type: 'string' } } } } } }

// =====================================================================
phase('Preflight ∥ Notes')
// Two independent inputs (bundle_ref, spec_refs) → two lines; the package needs both, so the join is real.
const [pre, notes] = await parallel([
  async () => {
    const digest = await agent(`Read the EvidenceBundle at ${A.bundle_ref} (if the file has a top-level "result" key, the bundle is result).
         Return its release_candidate_id, project_id, iteration, artifact_ref, specs, suite, escalations (task_id + reason only), starved_items (or []),
         panels: change_sets = distinct change_set_id in panel_results; for each change set take the panel_result with the highest round —
         final_pass/final_fail count those; vetoes = panel_results with veto_by set; rounds = panel_results.length.
         migrations_declared = the bundle has a "migrations" key; migrations = its value or []. Copy, never judge.`,
      { label: 'digest', model: MODEL.cheap, ...AT('mechanical'), schema: Digest })
    if (!digest) return null
    // artifact_ref names a branch; the branch may have moved or be gone. Pin a sha, re-run the suite there, scan the diff for migrations.
    const [artifact, queue] = await parallel([
      () => agent(`Artifact check, from the repo root. 1) git rev-parse --verify "${digest.artifact_ref}^{commit}" → sha; if it fails: exists=false, sha="", passed=failed=0,
           results_ref="", migration_files=[], files_changed=0 and stop. 2) git worktree add --detach .artifacts/launch/${digest.release_candidate_id} <sha>
           (if that path exists and is at <sha>, reuse it). 3) In <worktree>/${A.repo}/ run npm ci (if node_modules missing) then npm test; write
           {passed, failed, output_tail} to .artifacts/launch/${digest.release_candidate_id}.suite.json and return the counts and that path.
           4) files_changed = git diff --name-only $(git merge-base ${BASE} <sha>) <sha> | wc -l; migration_files = those paths matching /migrat|schema\\.sql|\\.sql$/i.
           If any git command fails (e.g. ${BASE} does not resolve), report it in notes and return exists=false; never substitute another ref or base.`,
        { label: 'artifact', model: MODEL.cheap, ...AT('mechanical'), schema: ArtifactCheck }),
      () => agent(`Run from the repo root: node substrate/gates.js list --json. Return every OPEN record as {id, gate, project_id (or "" if absent)}.`,
        { label: 'gate-queue', model: MODEL.cheap, ...AT('mechanical'), schema: GateQueue }),
    ])
    return { digest, artifact, queue }
  },
  () => agent(`Release Notes Writer. Read each spec at ${JSON.stringify(A.spec_refs ?? [])} and write user-facing release notes: one headline per spec
       (what changed for the API's users, not how), then a short "behavior changes" list. No internal ids in the prose. Write the markdown to
       .artifacts/launch/${A.run_id}.notes.md and return that path, a summary under 900 characters, and one headline per spec_id.`,
    { label: 'notes', model: MODEL.cheap, schema: Notes }),
])
if (!pre?.digest) return { failed: true, reason: 'bundle digest failed', provenance: stamp('launch', 'n/a', 'hitl') }
if (!pre.artifact || !pre.queue) return { failed: true, reason: 'artifact check or gate queue read failed', provenance: stamp('launch', 'n/a', 'hitl') }
const { digest, artifact, queue } = pre
const project = A.project_id ?? digest.project_id

// =====================================================================
phase('Package')
// Preflight is code. Every check is evidence-backed and has no default: a check with nothing to look at fails.
const openHere = queue.open.filter(g => !g.project_id || g.project_id === project)
const openSev1 = openHere.filter(g => g.gate === 'sev1_page')
const openEsc = openHere.filter(g => g.gate === 'escalation')
const migrationsOk = artifact.migration_files.length === 0 || (digest.migrations_declared && digest.migrations.length > 0 && digest.migrations.every(m => m.reversible))
const checks = [
  { name: 'suite_green_in_bundle', status: digest.suite.failed === 0 && digest.suite.passed > 0 ? 'pass' : 'fail',
    detail: `bundle reports ${digest.suite.passed} passed, ${digest.suite.failed} failed (${digest.suite.results_ref})` },
  { name: 'artifact_exists', status: artifact.exists ? 'pass' : 'fail',
    detail: artifact.exists ? `${digest.artifact_ref} = ${artifact.sha}` : `${digest.artifact_ref} does not resolve to a commit in this clone` },
  { name: 'suite_green_on_artifact', status: artifact.exists && artifact.failed === 0 && artifact.passed > 0 && artifact.passed >= digest.suite.passed ? 'pass' : 'fail',
    detail: artifact.exists ? `re-run at ${artifact.sha.slice(0, 8)}: ${artifact.passed} passed, ${artifact.failed} failed (${artifact.results_ref}); bundle said ${digest.suite.passed}` : 'not run: no artifact' },
  { name: 'all_change_sets_passed_panel', status: digest.panels.final_fail === 0 && digest.panels.final_pass === digest.panels.change_sets && digest.panels.change_sets > 0 ? 'pass' : 'fail',
    detail: `${digest.panels.final_pass}/${digest.panels.change_sets} change sets pass on their final round; ${digest.panels.vetoes} veto round(s) over ${digest.panels.rounds} rounds` },
  { name: 'no_unresolved_escalations', status: digest.escalations.length === 0 && openEsc.length === 0 ? 'pass' : 'fail',
    detail: `${digest.escalations.length} in bundle${digest.escalations.length ? ` (${digest.escalations.map(e => `${e.task_id}: ${e.reason}`).join('; ')})` : ''}; ${openEsc.length} open escalation gate(s)` },
  { name: 'no_open_sev1', status: openSev1.length === 0 ? 'pass' : 'fail', detail: openSev1.length ? openSev1.map(g => g.id).join(', ') : 'gate queue has no open sev1_page for this project' },
  { name: 'migrations_reversible', status: migrationsOk ? 'pass' : 'fail',
    detail: artifact.migration_files.length ? `diff carries ${artifact.migration_files.join(', ')}; bundle ${digest.migrations_declared ? `declares ${digest.migrations.length}` : 'declares none'}` : `no migration files in ${artifact.files_changed} changed file(s) since merge-base with ${BASE}` },
]
const go = checks.every(c => c.status === 'pass')
log(`preflight: ${go ? 'GO' : 'NO-GO'} — ${checks.filter(c => c.status === 'fail').map(c => c.name).join(', ') || 'all checks pass'}`)

return {
  release_candidate_id: digest.release_candidate_id,
  project_id: project,
  iteration: digest.iteration,
  bundle_ref: A.bundle_ref,
  artifact_ref: digest.artifact_ref,
  ...(artifact.exists ? { artifact_sha: artifact.sha } : {}),
  preflight: { go, checks },
  release_notes: notes?.summary ?? 'RELEASE NOTES UNAVAILABLE: the writer failed',
  ...(notes?.release_notes_ref ? { release_notes_ref: notes.release_notes_ref } : {}),
  evidence: {
    specs: digest.specs,
    suite: { passed: digest.suite.passed, failed: digest.suite.failed },
    ...(artifact.exists ? { suite_on_artifact: { passed: artifact.passed, failed: artifact.failed, results_ref: artifact.results_ref } } : {}),
    panels: digest.panels,
    escalations: digest.escalations,
    starved_items: digest.starved_items,
    open_gates: openHere.map(g => g.id),
  },
  // approve exists only on a go. A no-go can still be forced, but only by name and only with a note: /deploy refuses approve_override without one.
  options: go ? ['approve', 'veto'] : ['veto', 'approve_override'],
  provenance: stamp('launch', 'n/a', 'hitl'),
}
