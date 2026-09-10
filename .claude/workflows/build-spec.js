export const meta = {
  name: 'build-spec',
  description: 'Plan an iteration, write specs, classify risk and decompose in parallel. Ends at the Spec Gate: high-risk specs need a human decision before /build-implement.',
  phases: [{ title: 'Plan', detail: 'select work items within capacity' }, { title: 'Spec', detail: 'spec → (risk router ∥ decomposer) per item' }],
}

// args: { repo, workItems: WorkItem[], capacity: { tokens, iteration }, run_id, now, project_context? }
//   project_context: one sentence about the venture the router should know (e.g. "client: self, no external consumers yet").
//   repo: a directory of THIS git repository (e.g. "toy"); surfaces are repo-relative paths (toy/src/app.js).
// returns: { ready: [{spec, graph}], gated: [{spec, graph}], provenance }
//
// The human reviews `gated` in chat, then runs:
//   /build-implement with approved specs + the `ready` list

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
// Risk Router, code half: these are high by rule, no judgment needed. The agent half judges only what the rule cannot see.
const HIGH_KINDS = new Set(['schema', 'infra', 'config'])
const HIGH_REF = /auth|token|secret|credential|password|payment|billing|migrat|schema/i
const codeRisk = (spec) => {
  const reasons = []
  for (const s of spec.touched_surfaces ?? []) {
    if (HIGH_KINDS.has(s.kind)) reasons.push(`surface kind ${s.kind}: ${s.ref}`)
    else if (HIGH_REF.test(s.ref)) reasons.push(`surface ref matches a high-risk term: ${s.ref}`)
  }
  if (HIGH_REF.test(spec.goal ?? '')) reasons.push('goal mentions a high-risk term')
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

// =====================================================================
phase('Plan')
const plan = await agent(
  `Select work items to ship this iteration within ${A.capacity.tokens} tokens. Prefer higher priority and items
   with deferred_iterations > 0. Work items: ${JSON.stringify(A.workItems)}. Return the selected ids only.`,
  { label: 'planner', model: MODEL.cheap,
    schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } } })
const selected = A.workItems.filter(w => plan.ids.includes(w.id))
log(`Planned ${selected.length}/${A.workItems.length} work items`)

// =====================================================================
phase('Spec')
// One pipeline per work item. Inside each: Spec → (Router ∥ Decomposer). No barrier across items.
const specced = (await pipeline(selected, async (w) => {
  const spec = await agent(
    `Write a Spec for this work item for the app at ./${A.repo}/ (a directory of this git repository). Read its code and tests as needed.
     Surface refs are repository-relative paths (e.g. ${A.repo}/src/app.js).
     Acceptance criteria must be testable Given/When/Then. List every touched surface and what is out of scope.
     Work item: ${JSON.stringify(w)}`,
    { label: `spec:${w.id}`, model: MODEL.strong, schema: Spec })
  if (!spec) return null

  // Router and Decomposer both consume only the Spec — run together.
  const [risk, graph] = await parallel([
    () => agent(`Classify blast radius of this spec as low or high, with reasons. ${A.project_context ? `Project context: ${A.project_context}. ` : ''}
                 High ONLY if it changes the stored data shape, touches auth/secrets/payments/infra, is irreversible, or BREAKS an existing
                 route's contract for existing clients (an additive route, field, or query parameter is low). Spec: ${JSON.stringify(spec)}`,
      { label: `route:${w.id}`, model: MODEL.cheap, schema: Risk }),
    () => agent(`Decompose this spec into IMPLEMENTATION tasks with DISJOINT owned surfaces (no two tasks may own the same path).
                 Never create a task for writing tests or documentation: a separate Test Author writes tests from the spec, and criteria
                 about existing tests passing or npm test exiting 0 belong to the implementation task that touches the code.
                 Prefer ONE task; split only when two disjoint code surfaces can be built independently. Add depends_on only where one
                 task must read another's output. Every criterion must be covered by some task.
                 App at ./${A.repo}/ in this repository. Spec: ${JSON.stringify(spec)}`,
      { label: `decompose:${w.id}`, model: MODEL.cheap, schema: TaskGraph }),
  ])
  if (!risk || !graph) return null

  const ruleReasons = codeRisk(spec)
  const high = ruleReasons.length > 0 || risk.risk === 'high'
  if (ruleReasons.length) log(`${w.id}: high by rule (${ruleReasons[0]})`)
  return {
    spec: { ...spec, risk: high ? 'high' : 'low', risk_reasons: [...ruleReasons.map(r => `rule: ${r}`), ...risk.reasons],
            gate: high ? 'pending' : 'not_required',
            provenance: stamp('spec_writer', MODEL.strong, 'hotl') },
    graph: { ...graph, provenance: stamp('decomposer', MODEL.cheap, 'dark_factory') },
  }
})).filter(Boolean)

// Edge, not agent: split at the gate.
const ready = specced.filter(s => s.spec.gate === 'not_required')
const gated = specced.filter(s => s.spec.gate === 'pending')
log(`${ready.length} low-risk specs ready; ${gated.length} high-risk specs await Spec Gate`)

return { ready, gated, provenance: stamp('build-spec', 'n/a', 'hotl') }
