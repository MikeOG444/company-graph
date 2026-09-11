export const meta = {
  name: 'create-project',
  description: 'Project Create (OPERATING_MODEL §6): a signed ProjectBrief becomes a Workspace — repo handle, envs, CI, observability, comms, seeded backlog. Dark Factory; no gate inside.',
  phases: [
    { title: 'Signature', detail: 'mechanical: the brief_approval gate is decided "sign" for this brief' },
    { title: 'Provision', detail: '(scaffold → CI) ∥ backlog seeder; envs, observability, comms are code' },
    { title: 'Register', detail: 'the one join, code' },
  ],
}

// args: { brief: ProjectBrief (status "signed"; small enough to inline), gate: { gate_id }, repo, run_id, now,
//         hosting?: overrides brief.hosting (same shape), id_prefix?: work item id prefix (default "wi-<run_id>-") }
//   repo: a directory of THIS git repository that holds (or will hold) the app, e.g. "toy". Scaffolding an empty
//         directory is supported by the same node; the toy already exists so here it only verifies and installs.
// returns: Workspace (contracts.schema.json), or { refused: true, reason } — never a half-provisioned Workspace.
//
// Human touchpoints: none. The one human action on this stretch (signing the Brief) happened BEFORE this run,
// as a gate turn: gates open --gate brief_approval … → gates decide <id> sign. This run verifies that record
// instead of trusting args.brief.status: a signature is a file in gates/closed, not a string in args.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
const brief = A.brief
const project = brief.id

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const GateCheck = { type: 'object', additionalProperties: false, required: ['found', 'status', 'option', 'gate', 'payload_id'],
  properties: { found: { type: 'boolean' }, status: { type: 'string' }, option: { type: 'string' }, gate: { type: 'string' },
    payload_id: { type: 'string', description: 'payload.id of the gate record, or "" if absent' }, note: { type: 'string' } } }
const StackDecision = { type: 'object', additionalProperties: false, required: ['runtime', 'framework', 'test_runner', 'reasons'],
  properties: { runtime: { type: 'string' }, framework: { type: 'string' }, test_runner: { type: 'string' }, reasons: { type: 'array', items: { type: 'string' } } } }
const RepoHandle = { type: 'object', additionalProperties: false, required: ['existed', 'app_dir', 'sha', 'start_cmd', 'test_cmd', 'stack_ok'],
  properties: { existed: { type: 'boolean' }, app_dir: { type: 'string' }, sha: { type: 'string' }, start_cmd: { type: 'string' }, test_cmd: { type: 'string' },
    stack_ok: { type: 'boolean' }, notes: { type: 'string' } } }
const CiResult = { type: 'object', additionalProperties: false, required: ['passed', 'failed', 'results_ref'],
  properties: { passed: { type: 'integer' }, failed: { type: 'integer' }, results_ref: { type: 'string' } } }
const Seed = { type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['title', 'intent', 'priority'],
    properties: { title: { type: 'string' }, intent: { type: 'string' }, priority: { type: 'integer', minimum: 1 },
      budget: { type: 'object', additionalProperties: false, properties: { tokens: { type: 'integer' }, wall_clock_min: { type: 'integer' } } } } } } } }

const refuse = (reason) => { log(`refused: ${reason}`); return { refused: true, reason, project_id: project, provenance: stamp('create-project', 'n/a', 'dark_factory') } }

// =====================================================================
phase('Signature')
if (brief.status !== 'signed') return refuse(`brief.status is "${brief.status}", not "signed"`)
if (!A.gate?.gate_id) return refuse('no gate_id: the brief_approval gate record is the signature')
const gate = await agent(`Run from the repo root: node substrate/gates.js show ${A.gate.gate_id}. Report found (true if a record printed), its status, decision.option
                          (or "" if none), gate, payload.id (or ""), and decision.note if any. Do not interpret; copy the fields.`,
  { label: 'gate:brief_approval', model: MODEL.cheap, ...AT('mechanical'), schema: GateCheck })
if (!gate?.found) return refuse(`gate ${A.gate.gate_id} not found`)
if (gate.gate !== 'brief_approval' || gate.status !== 'decided' || gate.option !== 'sign') return refuse(`gate ${A.gate.gate_id} is ${gate.gate}/${gate.status}/${gate.option}, not brief_approval/decided/sign`)
if (gate.payload_id !== brief.id) return refuse(`gate ${A.gate.gate_id} signed brief ${gate.payload_id}, not ${brief.id}`)
log(`brief ${brief.id} signed at gate ${A.gate.gate_id}`)

// =====================================================================
phase('Provision')
// Env Provisioner needs a declared hosting target; the Brief carries it. No default: an undeclared target is a refusal, not localhost.
const hosting = A.hosting ?? brief.hosting
if (!hosting) return refuse('no hosting declared (brief.hosting or args.hosting): the Env Provisioner has nothing to provision')
if (!hosting.envs?.prod || !hosting.envs?.canary) return refuse('hosting.envs must name prod and canary: Launch deploys canary and promotes to prod')
if (hosting.app_dir !== A.repo) return refuse(`hosting.app_dir "${hosting.app_dir}" != args.repo "${A.repo}"`)

// Stack Selector: judgment only when the Brief leaves it open. With stack_preferences the decision is code.
const stack = brief.stack_preferences?.length
  ? { runtime: brief.stack_preferences[0], framework: brief.stack_preferences[1] ?? '', test_runner: brief.stack_preferences[2] ?? '', reasons: ['from brief.stack_preferences'] }
  : await agent(`Choose a stack for this project: runtime, framework, test runner, with reasons. Constraints: ${JSON.stringify(brief.constraints ?? [])}.
                 Problem: ${brief.problem}. Prefer boring, well-known choices.`, { label: 'stack', model: MODEL.cheap, schema: StackDecision })
if (!stack) return refuse('stack selection failed')

// Three independent inputs → three concurrent lines: (Scaffolder → CI) ∥ Seeder. Envs/observability/comms are code and cost nothing.
// The Registrar needs all of them, so this is the one real barrier.
const [repoLine, seed] = await parallel([
  async () => {
    const handle = await agent(`Repo Scaffolder. Stack: ${JSON.stringify(stack)}. Target directory: ./${A.repo}/ in THIS git repository (run from the repo root).
       If ./${A.repo}/package.json exists: existed=true; verify it is a ${stack.framework || stack.runtime} app (dependencies) and set stack_ok accordingly;
       run npm ci there if node_modules is missing; do NOT modify any file.
       If it does not exist: existed=false; scaffold the smallest ${stack.framework} app with a GET /health route returning {"status":"ok"}, a
       "start" script that honors PORT, a "test" script using ${stack.test_runner}, and one passing test; npm install; commit on the current branch.
       Return app_dir = "${A.repo}", sha = git rev-parse HEAD (repo root), start_cmd and test_cmd from package.json scripts, stack_ok.`,
      { label: 'scaffold', model: MODEL.cheap, ...AT('mechanical'), schema: RepoHandle })
    if (!handle) return null
    const ci = await agent(`CI Setup. From the repo root, in ./${handle.app_dir}/ run: ${handle.test_cmd}. Write a JSON summary {passed, failed, output_tail}
       to .artifacts/ci/${project}-${A.run_id}.json and return passed, failed, results_ref (that path). Counts come from the runner's own summary lines.`,
      { label: 'ci', model: MODEL.cheap, ...AT('mechanical'), schema: CiResult })
    return { handle, ci }
  },
  () => agent(`Backlog Seeder. Turn each line of the Brief's initial_scope into one WorkItem seed: a title, a one-paragraph intent (why it exists
       and what "done" looks like, from the Brief's problem, users and success metrics), and a priority (1 = first). Split a line only if it clearly
       names two independent deliverables. Do not invent scope. Brief: ${JSON.stringify({ problem: brief.problem, users: brief.users,
       success_metrics: brief.success_metrics, constraints: brief.constraints, initial_scope: brief.initial_scope })}.`,
    { label: 'seed', model: MODEL.cheap, schema: Seed }),
])
if (!repoLine?.handle) return refuse('scaffolder failed')
if (!repoLine.handle.stack_ok) return refuse(`./${A.repo}/ exists but is not a ${stack.framework || stack.runtime} app`)
if (!repoLine.ci) return refuse('CI setup failed')
if (!seed) return refuse('backlog seeder failed')
const { handle, ci } = repoLine
log(`repo ${handle.app_dir}@${handle.sha.slice(0, 8)} (${handle.existed ? 'existing' : 'scaffolded'}); CI ${ci.passed}/${ci.passed + ci.failed}; ${seed.items.length} work items seeded`)

// Env Provisioner (code for a local target: a port is a handle), Observability Setup (code: log + probe handles derived from envs), Comms Setup (code).
const envs = Object.fromEntries(Object.entries(hosting.envs).map(([name, port]) => [name, `http://127.0.0.1:${port}`]))
const observability = {
  health: '/health',
  ...Object.fromEntries(Object.keys(envs).map(name => [`${name}_request_log`, `.artifacts/deploy/${project}/${name}.log`])),
  watch_dir: `.artifacts/deploy/${project}/watch`,
  deploy_cli: 'node substrate/deploy.js',
}
const comms = brief.client === 'self'
  ? { client_channel: 'chat', review_queue: 'gates/open', status_page: `.artifacts/deploy/${project}/status.json` }
  : { client_channel: 'UNPROVISIONED: external client channels are a Phase 10 concern', review_queue: 'gates/open', status_page: `.artifacts/deploy/${project}/status.json` }

// =====================================================================
phase('Register')
const prefix = A.id_prefix ?? `wi-${A.run_id}-`
const backlog = seed.items
  .slice().sort((a, b) => a.priority - b.priority)
  .map((s, i) => ({ id: `${prefix}${i + 1}`, project_id: project, source: 'brief', title: s.title, intent: s.intent, priority: i + 1, deferred_iterations: 0,
                    ...(s.budget ? { budget: s.budget } : {}), provenance: stamp('backlog_seeder', MODEL.cheap, 'dark_factory') }))

return {
  project_id: project,
  repo: `${handle.app_dir}@${handle.sha}`,
  envs,
  ci_ref: `${handle.test_cmd} in ./${handle.app_dir}/ → ${ci.passed}/${ci.passed + ci.failed} at ${ci.results_ref}`,
  observability,
  comms,
  artifact_store: '.artifacts',
  backlog,
  provenance: stamp('create-project', 'n/a', 'dark_factory'),
}
