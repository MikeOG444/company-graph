export const meta = {
  name: 'build-reentry',
  description: 'Build re-entry (OPERATING_MODEL §3): Patch[] from Maintain + WorkItem[] (source=improve) → classify ∥ read the closed sev1 page → conflict map, budget split and merge plan in code → one ordered WorkItem[] for /build-spec. The Ratio Gate opens on breach only.',
  phases: [
    { title: 'Classify', detail: 'one cheap agent per patch (urgency + conflict surfaces + the WorkItem it becomes) ∥ per improve item missing surfaces ∥ the sev1 gate record' },
    { title: 'Plan', detail: 'code, 0 tokens: conflict detector, budget splitter, hotfix lane, merge planner, starvation' },
    { title: 'Emit', detail: 'ordered WorkItem[] + ReentryPlan, returned for the main session to persist and validate' },
  ],
}

// args: { project_id, repo, run_id, now, iteration,
//         patches?: Patch[] | patch_refs?: [path],            // from /maintain-triage (patches.json, or one file per patch)
//         work_items?: WorkItem[],                            // source=improve, from /improve-analyze
//         capacity: { tokens, iteration? },
//         health?: HealthReport | health_ref?: path,           // trend drives the split; maintain_ratio is MEASURED here
//         gate?: { gate_id },                                 // the CLOSED sev1_page record. Required when any patch is sev1.
//         ratio?: { guardrail (0.5), default_maintain (0.2),
//                   history: [{ iteration, actual_maintain, breach }] },  // pass [] to assert "no prior breach"; absent is not assumed
//         starvation_threshold? (2), artifact_dir?, new_agent_types?: false }
// returns: { work_items: WorkItem[] (ordered), plan: ReentryPlan, deferred, starved_items,
//            gate?: { gate: 'ratio_gate', options, next, payload_ref }, refs, provenance }
//          or { refused: true, reason } when a sev1 patch arrives without a decided sev1_page, or a breach cannot be judged.
//
// Human touchpoints: none inside. One gate at the boundary, and only on a breach:
//   gates open --gate ratio_gate --run <run_id> --workflow build-reentry --options adjust,accept --payload <plan>.json --next build-spec
//
// Post-run protocol for the main session (no agent writes a nested artifact):
//   1. node substrate/lib/run-output.js <task output> --save /tmp/<run>.json
//   2. node substrate/ledger.js append --workflow build-reentry --run <run_id> --started <args.now> --result /tmp/<run>.json ...
//   3. node -e "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync('/tmp/<run>.json','utf8'));const d='.artifacts/reentry/<run_id>';
//        fs.mkdirSync(d+'/items',{recursive:true});const w=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
//        w(d+'/plan.json',o.plan);w(d+'/work-items.json',o.work_items);for(const i of o.work_items)w(d+'/items/'+i.id+'.json',i)"
//      then substrate/validator.js ReentryPlan <plan> and WorkItem on each item, and open ratio_gate only if plan.gate_required.
// Deliberate deviations from §3, both recorded in ledger/ when this first ran:
//   1. The Ratio Gate sits at the END, not between the Budget Splitter and the Merge Planner. A gate inside the node chain would
//      make the planner wait for a person mid-run (CLAUDE.md rule 8). The plan is ordered either way and marked provisional on breach.
//   2. The Hotfix Lane does not go "to Implementer directly". With no Spec the Verifier Panel has no input, and §4 requires patches
//      to clear the panel like any change. A hotfix is first in the order with lane=hotfix, never a bypass of verification.
//   3. The Merge Planner is code. Ordering, lanes, overlap and counting are rule-3 edges; the only judgment per patch (what WorkItem
//      it becomes) is produced by the classifier that is already reading its diff, which also removes a barrier.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
const AT = (t) => (A.agent_types === false ? {} : { agentType: t })
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
const ART = A.artifact_dir ?? '.artifacts'
const DIR = `${ART}/reentry/${A.run_id}`
const project = A.project_id
const ITER = A.iteration ?? A.capacity?.iteration ?? 1
const R = { guardrail: 0.5, default_maintain: 0.2, ...(A.ratio ?? {}) }
const STARVED_AT = A.starvation_threshold ?? 2

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const Surface = { type: 'object', additionalProperties: false, required: ['kind', 'ref'],
  properties: { kind: { enum: ['path', 'module', 'api', 'schema', 'config', 'infra'] }, ref: { type: 'string' } } }
const Classification = { type: 'object', additionalProperties: false,
  required: ['urgency', 'urgency_reason', 'conflict_surfaces', 'title', 'intent'],
  properties: { urgency: { enum: ['hotfix', 'routine'] }, urgency_reason: { type: 'string' },
    conflict_surfaces: { type: 'array', minItems: 1, items: Surface },
    title: { type: 'string', maxLength: 120 }, intent: { type: 'string', maxLength: 900 } } }
const Surfaces = { type: 'object', additionalProperties: false, required: ['surfaces'],
  properties: { surfaces: { type: 'array', items: Surface }, reason: { type: 'string' } } }
const GateCheck = { type: 'object', additionalProperties: false,
  required: ['found', 'status', 'option', 'gate', 'payload_project_id', 'payload_signal_ids', 'decided_by', 'decided_at', 'note'],
  properties: { found: { type: 'boolean' }, status: { type: 'string' }, option: { type: 'string' }, gate: { type: 'string' },
    payload_project_id: { type: 'string' }, payload_signal_ids: { type: 'array', items: { type: 'string' } },
    decided_by: { type: 'string' }, decided_at: { type: 'string' }, note: { type: 'string' } } }
const Loaded = { type: 'object', additionalProperties: false, required: ['patches'],
  properties: { patches: { type: 'array', items: { type: 'object' } }, health: { type: 'object' }, error: { type: 'string' } } }

// Patch JSONs keep their own ref: whatever the caller passed, not a path this script reconstructs from a run id.
const refById = new Map()
for (const r of A.patch_refs ?? []) { const m = /([^/]+)\.json$/.exec(String(r)); if (m) refById.set(m[1], r) }

const refuse = (reason) => { log(`refused: ${reason}`); return { refused: true, reason, provenance: stamp('build-reentry', 'n/a', 'hitl') } }
const skey = (s) => `${s.kind}:${s.ref}`

// =====================================================================
phase('Classify')
let patches = A.patches ?? []
let health = A.health && !A.health_ref ? A.health : null
if ((!patches.length && (A.patch_refs?.length || A.patches_ref)) || (!health && A.health_ref)) {
  const loaded = await agent(`Read JSON and return it verbatim; copy, never interpret, never repair.
       ${A.patches_ref ? `patches = the array at ${A.patches_ref}.` : A.patch_refs?.length ? `patches = the array formed by reading each of ${JSON.stringify(A.patch_refs)} in that order.` : 'patches = [].'}
       ${A.health_ref ? `health = the object at ${A.health_ref}.` : ''}
       If a file is missing, say so in error and return what you have.`,
    { label: 'load', model: MODEL.cheap, ...AT('mechanical'), schema: Loaded })
  if (loaded?.error) log(`load: ${loaded.error}`)
  if (!patches.length) patches = loaded?.patches ?? []
  if (!health && loaded?.health) health = loaded.health
}
const improveItems = (A.work_items ?? []).filter(w => w.source === 'improve' || w.source === 'brief' || w.source === 'launch_veto')
if (!patches.length && !improveItems.length) return refuse('nothing to merge: no patches and no work items')

// A sev1 patch means production was touched. Its place in the queue depends on a decision the human already made at the
// sev1 page, and that decision is read from the gate FILE, never from args (the Phase 3 convention).
const sev1Patches = patches.filter(p => p.severity === 'sev1')
if (sev1Patches.length && !A.gate?.gate_id) return refuse(`${sev1Patches.length} sev1 patch(es) and no gate_id: the sev1 page decides whether the mitigation is still holding, and it is read from gates/, not from args`)

// One barrier, and it is the one §3 names: the Merge Planner needs every classification, the gate record and every surface set.
const thunks = [
  ...patches.map(p => () => agent(`Classify one Patch for Build re-entry and write the WorkItem it becomes. Read its diff at ${p.change_set.diff_ref} and the repo (app at ./${A.repo}/).
       urgency: "hotfix" only if production is currently wrong for users in a way that cannot wait for the normal iteration — otherwise "routine".
         Severity is evidence, not the answer: a sev1 whose mitigation is still holding production can be routine, and a sev2 that corrupts stored data cannot.
       urgency_reason: one sentence, from the diff and the cause.
       conflict_surfaces: every surface this patch touches, repository-relative, from the DIFF — this is what overlap detection runs on, so list them all and nothing speculative.
       title: imperative, under 120 characters, no ids. intent: one paragraph a Spec Writer can work from — the defect, the user-visible symptom, and that a
         regression test already exists on branch ${p.change_set.branch ?? '(none)'}. Never describe the fix as optional.
       Patch (diff by ref, never inlined): ${JSON.stringify({ id: p.id, severity: p.severity, signal_ids: p.signal_ids, cause: p.cause, repro: { status: p.repro?.status, steps: p.repro?.steps, observed: p.repro?.observed, expected: p.repro?.expected }, verification: p.verification?.verified, branch: p.change_set.branch, base_commit: p.change_set.base_commit })}`,
    { label: `classify:${p.id}`, phase: 'Classify', model: MODEL.cheap, schema: Classification }).then(c => c && { kind: 'patch', patch: p, c })),
  ...improveItems.filter(w => !(w.surfaces?.length)).map(w => () => agent(`Name the surfaces this work item would touch, so conflict detection has something to overlap on.
       Read the app at ./${A.repo}/. Repository-relative refs, narrowest that is honest; [] is a valid answer when the intent names nothing in the code.
       Work item: ${JSON.stringify({ id: w.id, title: w.title, intent: w.intent })}`,
    { label: `surfaces:${w.id}`, phase: 'Classify', model: MODEL.cheap, schema: Surfaces }).then(s => s && { kind: 'surfaces', item: w, s })),
  ...(A.gate?.gate_id ? [() => agent(`Run from the repo root: node substrate/gates.js show ${A.gate.gate_id}. Report found, status, gate, decision.option ("" if none),
       payload.project_id ("" if absent), payload.signal_ids ([] if absent), decision.decided_by, decision.decided_at, decision.note ("" if none).
       Copy, never interpret. If the command fails, found=false and the error text in note.`,
    { label: 'gate:sev1_page', phase: 'Classify', model: MODEL.cheap, ...AT('mechanical'), schema: GateCheck }).then(g => g && { kind: 'gate', g })] : []),
]
const results = (await parallel(thunks)).filter(Boolean)
const gate = results.find(r => r.kind === 'gate')?.g ?? null
const classOf = new Map(results.filter(r => r.kind === 'patch').map(r => [r.patch.id, r.c]))
const surfacesOf = new Map(results.filter(r => r.kind === 'surfaces').map(r => [r.item.id, r.s.surfaces]))
if (patches.some(p => !classOf.has(p.id))) return refuse(`classification failed for ${patches.filter(p => !classOf.has(p.id)).map(p => p.id).join(', ')}`)

// ---- the sev1 page decision, verified against the record ----
let pageOption = null
if (sev1Patches.length) {
  if (!gate?.found) return refuse(`gate ${A.gate.gate_id} not found`)
  if (gate.gate !== 'sev1_page' || gate.status !== 'decided') return refuse(`gate ${A.gate.gate_id} is ${gate.gate}/${gate.status}, not sev1_page/decided`)
  if (gate.payload_project_id && gate.payload_project_id !== project) return refuse(`gate ${A.gate.gate_id} is for ${gate.payload_project_id}, not ${project}`)
  const paged = new Set(gate.payload_signal_ids ?? [])
  const uncovered = sev1Patches.filter(p => !(p.signal_ids ?? []).some(id => paged.has(id)))
  if (uncovered.length) return refuse(`sev1 patch(es) ${uncovered.map(p => p.id).join(', ')} answer signals the page at ${A.gate.gate_id} never covered (${[...paged].join(', ') || 'no signal ids on the payload'})`)
  pageOption = gate.option
  if (!['keep_mitigation', 'lift_mitigation', 'direct_drive', 'accept_unmitigated'].includes(pageOption)) return refuse(`unknown sev1 page decision "${pageOption}"`)
  log(`sev1 page ${A.gate.gate_id}: ${pageOption} by ${gate.decided_by} at ${gate.decided_at}${gate.note ? ` — ${gate.note}` : ''}`)
}

// =====================================================================
phase('Plan')
// Everything below is script code: 0 tokens, replayable, and the place where the decisions are auditable.

// Patch Classifier, code half: the page decision overrides the agent's urgency for sev1, because only the human knows
// whether production is still behind a mitigation. Keeping a mitigation makes the patch the thing that lifts it.
const MIT_HOLDS = pageOption === 'keep_mitigation'
const candidates = []
for (const p of patches) {
  const c = classOf.get(p.id)
  const verified = p.verification?.verified === true
  let urgency = c.urgency, why = c.urgency_reason
  if (p.severity === 'sev1') {
    if (MIT_HOLDS) { urgency = 'routine'; why = `sev1 page: the mitigation is held, so production is not serving the defect; shipping this patch is what lifts it (${c.urgency_reason})` }
    else { urgency = 'hotfix'; why = `sev1 page: ${pageOption} — production carries the defect again (${c.urgency_reason})` }
  }
  const surfaces = [...new Map([...(c.conflict_surfaces ?? []), ...(p.change_set.touched_surfaces ?? [])].map(s => [skey(s), s])).values()]
  candidates.push({
    key: `wi-${p.id}`, lane: urgency === 'hotfix' ? 'hotfix' : 'maintain', kind: 'patch', patch: p, verified,
    source: urgency === 'hotfix' ? 'hotfix' : 'maintain_patch',
    title: c.title, priority: p.severity === 'sev1' ? 1 : p.severity === 'sev2' ? 2 : 3,
    deferred_iterations: 0, surfaces,
    intent: `${c.intent}\n\n[re-entry] ${p.severity}, ${urgency}: ${why} Cause: ${p.cause.location} — ${p.cause.hypothesis} ` +
      (verified
        ? `A verified patch already exists on branch ${p.change_set.branch} (base ${String(p.change_set.base_commit).slice(0, 8)}): the regression test fails at base and passes there, suite green. Re-verify that branch rather than re-implementing it.`
        : `The drafted patch is NOT verified (${(p.verification?.checks ?? []).filter(k => k.status === 'fail').map(k => k.name).join(', ') || 'no measurements'}), so its branch is deliberately not offered to Build: implement this from the cause and the repro at ${p.repro?.failing_test_ref ?? 'the patch record'}.`),
    ...(verified ? { branch: p.change_set.branch } : {}),
  })
  if (!verified) log(`${p.id}: unverified — entering the queue as ordinary work, branch withheld`)
}
for (const w of improveItems) {
  candidates.push({ key: w.key ?? w.id, lane: 'improve', kind: 'item', item: w, verified: true,
    source: w.source, title: w.title, priority: w.priority ?? 5, intent: w.intent,
    deferred_iterations: w.deferred_iterations ?? 0,
    surfaces: w.surfaces?.length ? w.surfaces : (surfacesOf.get(w.id) ?? []) })
}

// ---- Conflict Detector (code): overlap on Surface, with path containment, not just equality ----
const norm = (s) => String(s.ref).replace(/^\.\//, '').replace(/\/+$/, '')
const touches = (a, b) => a.kind === b.kind && (norm(a) === norm(b) || norm(a).startsWith(`${norm(b)}/`) || norm(b).startsWith(`${norm(a)}/`))
const overlapPairs = []
const overlapMap = new Map()
for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
  const hit = []
  for (const sa of candidates[i].surfaces) for (const sb of candidates[j].surfaces) if (touches(sa, sb)) hit.push(skey(sa))
  if (!hit.length) continue
  for (const h of [...new Set(hit)]) {
    if (!overlapMap.has(h)) overlapMap.set(h, new Set())
    overlapMap.get(h).add(candidates[i].key); overlapMap.get(h).add(candidates[j].key)
  }
  // patch-before-feature: the only thing overlap is allowed to order (§3)
  const a = candidates[i], b = candidates[j]
  if (a.kind === 'patch' && b.kind === 'item') overlapPairs.push([a.key, b.key])
  else if (b.kind === 'patch' && a.kind === 'item') overlapPairs.push([b.key, a.key])
}
const overlaps = [...overlapMap.entries()].map(([surface, ids]) => ({ surface, work_item_ids: [...ids] }))
if (overlaps.length) log(`${overlaps.length} overlapping surface(s); ${overlapPairs.length} patch-before-feature constraint(s)`)

// ---- Budget Splitter (code, rule-based): 20/80 by default, shifted by the health trend ----
const trend = health?.trend ?? null
const maintainShare = trend === 'degrading' ? 0.4 : trend === 'improving' ? 0.1 : R.default_maintain
const capTokens = A.capacity?.tokens ?? 0
const allHaveBudget = candidates.length > 0 && candidates.every(c => (c.item?.budget?.tokens ?? 0) > 0)
const DEFAULT_ITEM_TOKENS = candidates.length ? Math.floor((capTokens || candidates.length * 100000) / candidates.length) : 0
const weight = (c) => c.item?.budget?.tokens ?? DEFAULT_ITEM_TOKENS
const unit = allHaveBudget ? 'tokens (every item carried a budget)' : `even share (${DEFAULT_ITEM_TOKENS} tokens/item: not every item carried a budget)`
const ratioRule = `default maintain ${R.default_maintain}; trend ${trend ?? 'unknown (treated as stable)'} → ${maintainShare}; hotfixes pre-empt and are counted in the actual share; measured in ${unit}`

// ---- Hotfix Lane + selection (code): hotfixes pre-empt, then each lane fills its own budget ----
const bySeverityThenPriority = (a, b) => a.priority - b.priority || a.key.localeCompare(b.key)
const hotfix = candidates.filter(c => c.lane === 'hotfix').sort(bySeverityThenPriority)
const maintain = candidates.filter(c => c.lane === 'maintain').sort(bySeverityThenPriority)
const improve = candidates.filter(c => c.lane === 'improve').sort((a, b) => a.priority - b.priority || (b.deferred_iterations - a.deferred_iterations) || a.key.localeCompare(b.key))
let spentHotfix = 0
for (const h of hotfix) spentHotfix += weight(h)
const selected = [...hotfix]
const deferred = []
const fill = (lane, budget) => {
  let spent = 0
  for (const c of lane) {
    const w = weight(c)
    if (capTokens && spent + w > budget) { deferred.push(c); continue }
    spent += w; selected.push(c)
  }
  return spent
}
const remaining = Math.max(0, capTokens - spentHotfix)
const spentMaintain = fill(maintain, remaining * maintainShare)
const spentImprove = fill(improve, remaining * (1 - maintainShare))
const maintainTokens = spentHotfix + spentMaintain
const totalTokens = maintainTokens + spentImprove
const actualMaintain = totalTokens > 0 ? maintainTokens / totalTokens : 0

// ---- the Ratio Gate is a boundary, and a breach is only a breach when it is the second in a row ----
const breach = actualMaintain > R.guardrail
const history = A.ratio?.history
let streak = breach ? 1 : 0
let historyKnown = true
if (breach) {
  if (!history) {
    if (ITER > 1) return refuse(`maintain share ${actualMaintain.toFixed(2)} breaches the ${R.guardrail} guardrail at iteration ${ITER}, and ratio.history was not supplied: "two iterations in a row" cannot be established. Pass ratio.history (use [] to assert there was no prior breach) — this run will not guess, and it will not let the breach pass unnoticed either`)
    historyKnown = false   // iteration 1 cannot have a streak of two
  } else {
    for (let i = ITER - 1; i >= 1; i--) {
      const h = history.find(x => x.iteration === i)
      if (h?.breach) streak++; else break
    }
  }
}
const gateRequired = breach && streak >= 2
log(`ratio: maintain ${actualMaintain.toFixed(2)} vs guardrail ${R.guardrail}${breach ? ` — BREACH, streak ${streak}${gateRequired ? ' → Ratio Gate' : ' (one breach is not two)'}` : ''}`)

// ---- Merge Planner (code): priority order, then patch-before-feature promoted by a stable topological pass ----
const selKeys = new Set(selected.map(c => c.key))
const pairs = overlapPairs.filter(([a, b]) => selKeys.has(a) && selKeys.has(b))
const base = [...selected].sort((a, b) => {
  const laneRank = { hotfix: 0, maintain: 1, improve: 2 }
  return laneRank[a.lane] - laneRank[b.lane] || a.priority - b.priority || a.key.localeCompare(b.key)
})
const indeg = new Map(base.map(c => [c.key, 0]))
const succ = new Map(base.map(c => [c.key, []]))
for (const [a, b] of pairs) { succ.get(a).push(b); indeg.set(b, indeg.get(b) + 1) }
const ordered = []
const ready = base.filter(c => indeg.get(c.key) === 0)
while (ready.length) {
  const c = ready.shift()
  ordered.push(c)
  for (const s of succ.get(c.key)) { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) ready.push(base.find(x => x.key === s)) }
  ready.sort((a, b) => base.indexOf(a) - base.indexOf(b))
}
if (ordered.length !== base.length) { for (const c of base) if (!ordered.includes(c)) ordered.push(c) }   // a cycle cannot starve the queue

// ---- Starvation (code): §3's EvidenceBundle.starved_items, which nothing produced until now ----
for (const d of deferred) d.deferred_iterations = (d.deferred_iterations ?? 0) + 1
const starved = deferred.filter(d => d.deferred_iterations >= STARVED_AT).map(d => d.key)
if (deferred.length) log(`${deferred.length} item(s) deferred, ${starved.length} now starved (>= ${STARVED_AT} iterations)`)

// =====================================================================
phase('Emit')
const work_items = ordered.map((c, i) => ({
  id: c.key,
  project_id: project,
  source: c.source,
  title: c.title,
  intent: c.intent,
  priority: i + 1,                                    // the order IS the priority downstream; the original is in the plan
  deferred_iterations: c.deferred_iterations ?? 0,
  ...(c.item?.budget ? { budget: c.item.budget } : {}),
  ...(c.surfaces.length ? { surfaces: c.surfaces } : {}),
  ...(c.kind === 'patch' ? { signal_ids: c.patch.signal_ids,
        patch_ref: refById.get(c.patch.id) ?? `${ART}/maintain/${String(c.patch.provenance?.run_id ?? 'unknown')}/patches/${c.patch.id}.json` } : {}),
  ...(c.branch ? { branch: c.branch } : {}),
  provenance: stamp(c.kind === 'patch' ? 'merge_planner' : 'backlog_emitter', 'n/a', 'dark_factory'),
}))
const plan = {
  project_id: project,
  iteration: ITER,
  ratio: { maintain: maintainShare, improve: 1 - maintainShare, rule: ratioRule, ...(trend ? { trend } : {}),
    actual_maintain: Number(actualMaintain.toFixed(4)), guardrail: R.guardrail, breach, breach_streak: streak, history_known: historyKnown },
  order: ordered.map((c, i) => ({ work_item_id: c.key, lane: c.lane,
    reason: `${i + 1}. ${c.lane} lane, original priority ${c.priority}` +
      (pairs.some(([a]) => a === c.key) ? `; patch before the feature(s) it overlaps (${pairs.filter(([a]) => a === c.key).map(([, b]) => b).join(', ')})` : '') +
      (c.kind === 'patch' ? (c.verified ? `; verified patch on ${c.branch}` : '; unverified patch, branch withheld') : '') })),
  overlaps,
  deferred: deferred.map(d => d.key),
  starved_items: starved,
  capacity: { ...(capTokens ? { tokens: capTokens } : {}), maintain_tokens: maintainTokens, improve_tokens: spentImprove },
  gate_required: gateRequired,
  provenance: stamp('build-reentry', 'n/a', gateRequired ? 'hitl' : 'dark_factory'),
}

// Nothing here is written by an agent. The plan and the ordered work items ARE this run's return value, and a cheap model
// retyping a nested artifact is a known defect source (m1b: three of repro's fields hoisted to a Patch root). The main
// session writes them from the saved result, deterministically, and validates them — see the post-run protocol above.
log(`${work_items.length} work item(s) ordered for /build-spec: ${work_items.map(w => `${w.id}[${ordered.find(o => o.key === w.id).lane}]`).join(' → ')}`)

return {
  project_id: project,
  work_items,
  plan,
  deferred: plan.deferred,
  starved_items: starved,
  // On breach the ordered list is provisional: the human adjusts the split, and /build-spec takes the decision.
  ...(gateRequired ? { gate: { gate: 'ratio_gate', options: ['adjust', 'accept'], next: 'build-spec', payload_ref: `${DIR}/plan.json` } } : {}),
  refs: { dir: DIR, plan: `${DIR}/plan.json`, work_items: `${DIR}/work-items.json` },
  provenance: stamp('build-reentry', 'n/a', gateRequired ? 'hitl' : 'dark_factory'),
}
