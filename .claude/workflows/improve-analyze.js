export const meta = {
  name: 'improve-analyze',
  description: 'Improve (OPERATING_MODEL §5): telemetry ∥ feedback ∥ kill-criteria facts ∥ burn → Opportunity[] → ranked in code + VentureVerdict derived in code → one Roadmap Gate. Ends at the gate; the Backlog Emitter is on the other side of it.',
  phases: [
    { title: 'Analyze', detail: 'usage analyst ∥ feedback analyst ∥ kill-criteria detector ∥ ledger burn — four independent reads, no path between them' },
    { title: 'Synthesize', detail: 'the one barrier: Opportunity[] from both analyses + HealthReport + brief' },
    { title: 'Rank', detail: 'code, 0 tokens: prioritizer, budget cut, verdict numbers; one agent writes the rationale code already decided' },
  ],
}

// args: { project_id, repo, run_id, now,
//         telemetry_ref, feedback_ref,                      // by ref: the analysts read them (rule 4)
//         brief: ProjectBrief, health: HealthReport,         // small, inlined
//         backlog?: WorkItem[],                              // existing improve backlog, for dedupe
//         calibration?: [{work_type, factor}],               // from /memory-roll when it has run
//         burn?: { tokens, dollars, human_hours },           // skip the ledger read by supplying it
//         cost_weights?: { human_min_per_1k_tokens (8) },
//         artifact_dir?, agent_types?: false }
// returns: { opportunities: Opportunity[] (ranked, scored, cut), verdict: VentureVerdict,
//            draft_work_items: WorkItem[], unmeasured: [metric], gate: {...}, provenance }
//
// Human touchpoints: ONE, at the boundary. §5.2 says the human decides "what next" and "whether to continue"
// in one sitting, so it is one GateRecord, not two:
//   node substrate/gates.js open --gate roadmap_gate --run <run_id> --workflow improve-analyze \
//     --options keep,sell,kill,pivot --payload <payload>.json --next build-reentry
// decision.option carries the VentureVerdict recommendation; decision.selection carries the approved
// Opportunity ids. Two records could not express the dependency between them — an approved backlog under a
// `kill` verdict is incoherent and the substrate has no "record B is valid only if A said keep".
//
// Post-run protocol for the main session (no agent writes a nested artifact):
//   1. node substrate/lib/run-output.js <task output> --save /tmp/<run>.json
//   2. node substrate/ledger.js append --workflow improve-analyze --run <run_id> --started <args.now> ... --tokens-by-model '{...}'
//   3. node -e "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync('/tmp/<run>.json','utf8'));const d='.artifacts/improve/<run_id>';
//        fs.mkdirSync(d+'/opportunities',{recursive:true});const w=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
//        w(d+'/opportunities.json',o.opportunities);w(d+'/verdict.json',o.verdict);w(d+'/draft-work-items.json',o.draft_work_items);
//        for(const x of o.opportunities)w(d+'/opportunities/'+x.id+'.json',x)"
//      then validator.js Opportunity on each and VentureVerdict on the verdict, then open the gate.
//
// Deliberate deviations from §5, and why:
//   1. The Backlog Emitter is NOT in this workflow. §5's diagram draws it inside Improve, but it consumes the
//      gate decision, and a gate is a workflow boundary (CLAUDE.md rule 8). What ships here is draft_work_items,
//      assembled in code; the human's selection at the gate says which of them become real.
//   2. §5.2 calls Verdict Evaluator ∥ Prioritizer a parallel. That only holds if "remaining backlog value" is
//      read off the Synthesizer's Opportunity[] rather than off the ranked cut — otherwise the Evaluator waits
//      on the Prioritizer and the parallel is false. This takes the first reading: remaining_backlog_value is a
//      property of the opportunities, not of the ranking. Both halves read the same upstream.
//   3. The Feedback Collector is not a node. §5 calls it "code, continuous"; normalizing committed JSON is a
//      read, and a node that only reformats is an edge (rule 1).
//   4. Kill criteria are free text, so a cheap agent DETECTS whether each one's condition occurred and cites the
//      fact. It never sees the recommendation and never proposes one: §5.3's rules are applied in script code
//      below. This is the m1 lesson (an agent voting on severity paged a human over a 200) applied to the verdict.

const A = args
const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }
// .claude/agents/ definitions register from the COMMITTED tree, but the runtime's scan has lag: agents committed
// during a session are not necessarily available to that session's next run (observed on run i1/mr1 — committing
// them was not enough). missing_agent_types names the ones this session cannot resolve, so a run can proceed with
// the definitions it does have instead of losing them all to the blunt agent_types:false hatch. When a type is
// dropped its ROLE PROMPT is dropped with it, so every constraint that matters is also stated inline below.
const MISSING = new Set(A.missing_agent_types ?? [])
const AT = (t) => (A.agent_types === false || MISSING.has(t) ? {} : { agentType: t })
const stamp = (node, model, method) => ({ node, executor: 'ai_agent', method, model, run_id: A.run_id, created_at: A.now })
const ART = A.artifact_dir ?? '.artifacts'
const DIR = `${ART}/improve/${A.run_id}`
const project = A.project_id
const brief = A.brief
const health = A.health
const backlog = A.backlog ?? []
// One human-minute is priced at this many tokens when scoring cost. Declared, not hidden, so the ledger can argue with it.
const HUMAN_MIN_PER_1K = A.cost_weights?.human_min_per_1k_tokens ?? 8

const refuse = (reason) => ({ refused: true, reason, provenance: stamp('improve-analyze', 'n/a', 'hotl') })
if (!brief) return refuse('no ProjectBrief: §5 cannot evaluate a venture without success_metrics, kill_criteria and budget')
if (!health) return refuse('no HealthReport: the Synthesizer is a sync point on both analyses AND health (§5.2)')

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const Surface = { type: 'object', additionalProperties: false, required: ['kind', 'ref'],
  properties: { kind: { enum: ['path', 'module', 'api', 'schema', 'config', 'infra'] }, ref: { type: 'string' } } }
const Insights = { type: 'object', additionalProperties: false, required: ['insights', 'metric_readings'],
  properties: {
    insights: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'observation', 'counter', 'value', 'metric', 'kind'],
      properties: { id: { type: 'string' }, observation: { type: 'string' },
        counter: { type: 'string', description: 'which field of the snapshot this came from' },
        value: { type: 'string', description: 'the actual value, quoted' },
        metric: { type: 'string', description: 'a ProjectBrief.success_metrics.metric verbatim, or "" when it binds to none' },
        kind: { enum: ['movement', 'level'] } } } },
    metric_readings: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['metric', 'measured', 'actual_text'],
      properties: { metric: { type: 'string' }, measured: { type: 'boolean' },
        actual_number: { type: ['number', 'null'] }, actual_text: { type: 'string' },
        source: { type: 'string' } } } } } }
const Themes = { type: 'object', additionalProperties: false, required: ['themes'],
  properties: { themes: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['id', 'theme', 'ask', 'item_ids', 'frequency', 'sentiment', 'quote'],
    properties: { id: { type: 'string' }, theme: { type: 'string' }, ask: { type: 'string' },
      item_ids: { type: 'array', items: { type: 'string' } }, frequency: { type: 'integer', minimum: 1 },
      sentiment: { enum: ['positive', 'neutral', 'negative'] }, quote: { type: 'string' } } } } } }
const KillFacts = { type: 'object', additionalProperties: false, required: ['criteria'],
  properties: { criteria: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['criterion', 'condition_occurred', 'fact', 'source', 'determinable'],
    properties: { criterion: { type: 'string', description: 'the criterion text, verbatim' },
      condition_occurred: { type: 'boolean' },
      determinable: { type: 'boolean', description: 'false when the inputs cannot settle it either way' },
      fact: { type: 'string' }, source: { type: 'string' } } } } } }
const Burn = { type: 'object', additionalProperties: false, required: ['tokens', 'dollars', 'found'],
  properties: { tokens: { type: 'integer', minimum: 0 }, dollars: { type: 'number', minimum: 0 },
    human_min: { type: 'integer', minimum: 0 }, found: { type: 'boolean' }, note: { type: 'string' } } }
const Synthesis = { type: 'object', additionalProperties: false, required: ['opportunities'],
  properties: { opportunities: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['id', 'hypothesis', 'evidence', 'metric_impacted', 'expected_value', 'estimated_cost', 'confidence', 'surfaces', 'title', 'intent'],
    properties: { id: { type: 'string' }, hypothesis: { type: 'string' },
      evidence: { type: 'array', minItems: 1, items: { type: 'string' } },
      metric_impacted: { type: 'string' }, expected_value: { type: 'number' },
      estimated_cost: { type: 'object', additionalProperties: false, required: ['tokens', 'human_min'],
        properties: { tokens: { type: 'integer' }, human_min: { type: 'integer' } } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      surfaces: { type: 'array', items: Surface },
      duplicate_of: { type: 'string', description: 'an existing WorkItem id this duplicates, or ""' },
      title: { type: 'string', description: 'imperative, under 120 chars — the WorkItem this becomes if approved' },
      intent: { type: 'string', description: 'one paragraph a Spec Writer could work from' } } } } } }
const Rationale = { type: 'object', additionalProperties: false, required: ['rationale'],
  properties: { rationale: { type: 'string' }, concerns: { type: 'array', items: { type: 'string' } } } }

// =====================================================================
phase('Analyze')
// Four reads, no path between any two of them. This is a real barrier: the Synthesizer is §5.2's sync point and
// needs both analyses together, and the verdict needs the kill facts and the burn.
const metricNames = (brief.success_metrics ?? []).map(m => m.metric)
const [usage, feedback, killFacts, burnRead] = await parallel([
  () => agent(`Read the TelemetrySnapshot at ${A.telemetry_ref} and report what the numbers did.
     The venture's success metrics, verbatim, are: ${JSON.stringify(metricNames)}.
     For every insight: quote the counter it came from and its actual value. Bind metric to one of those
     strings ONLY when the number honestly moves it; otherwise metric = "".
     Also return metric_readings: one row per success metric above, saying whether this snapshot measures it at all
     (measured), the value if it does (actual_number when it is a number, actual_text always), and which counter said so.
     A metric the snapshot does not cover is measured=false — never estimate one.
     ProjectBrief for context (do not re-derive its metrics): ${JSON.stringify({ id: brief.id, name: brief.name, users: brief.users, success_metrics: brief.success_metrics })}`,
    { label: 'usage_analyst', phase: 'Analyze', model: MODEL.cheap, ...AT('usage-analyst'), schema: Insights }),

  () => agent(`Read the FeedbackItem[] at ${A.feedback_ref} and group them into themes.
     Every theme carries item_ids, an integer frequency you can count, a sentiment you can defend, and a quote
     from an actual item. ask is what the sender asked for in THEIR terms, never your solution to it.
     A single item is a theme of frequency 1; report it as one rather than inflating or dropping it.`,
    { label: 'feedback_analyst', phase: 'Analyze', model: MODEL.cheap, ...AT('feedback-analyst'), schema: Themes }),

  () => agent(`For each kill criterion below, report ONLY whether its condition occurred, and the fact that settles it.
     You are a detector. You do not know and must not guess what recommendation follows; that is decided in code.
     Read the TelemetrySnapshot at ${A.telemetry_ref} and use the HealthReport inlined below. Cite the counter or
     field in source. When the inputs cannot settle a criterion either way, set determinable=false and
     condition_occurred=false, and say in fact what would be needed to settle it — never guess in either direction.
     Kill criteria (verbatim): ${JSON.stringify(brief.kill_criteria ?? [])}
     HealthReport: ${JSON.stringify(health)}`,
    { label: 'kill_criteria_facts', phase: 'Analyze', model: MODEL.cheap, ...AT('usage-analyst'), schema: KillFacts }),

  () => (A.burn
    ? Promise.resolve({ tokens: A.burn.tokens ?? 0, dollars: A.burn.dollars ?? 0, human_min: Math.round((A.burn.human_hours ?? 0) * 60), found: true, note: 'supplied in args' })
    : agent(`Run from the repository root: node substrate/ledger.js summary
       Report the TOTAL tokens and total cost_est_usd across every row, and total human minutes if the summary shows them.
       Copy the numbers, never interpret or recompute them. If the command fails, found=false and the error text in note,
       and tokens/dollars 0 — do not substitute an estimate.`,
      { label: 'burn:ledger', phase: 'Analyze', model: MODEL.cheap, ...AT('mechanical'), schema: Burn })),
])

if (!usage) return refuse('usage analyst returned nothing; the Synthesizer is a sync point and cannot run on one analysis')
if (!feedback) return refuse('feedback analyst returned nothing; the Synthesizer is a sync point and cannot run on one analysis')
const burn = burnRead ?? { tokens: 0, dollars: 0, human_min: 0, found: false, note: 'burn read failed' }
log(`${usage.insights.length} insights, ${feedback.themes.length} themes, burn ${burn.found ? '$' + burn.dollars : 'UNKNOWN'}`)

// =====================================================================
phase('Synthesize')
const synth = await agent(
  `Synthesize Opportunity[] for project ${project}. This is the one sync point in §5: you see both analyses together.
   Read the repo (app at ./${A.repo}/) to cost each opportunity from the code it would touch.
   Usage insights: ${JSON.stringify(usage.insights)}
   Feedback themes: ${JSON.stringify(feedback.themes)}
   HealthReport: ${JSON.stringify(health)}
   ProjectBrief: ${JSON.stringify(brief)}
   Existing improve backlog — dedupe against it, and set duplicate_of to the WorkItem id rather than proposing a
   second copy: ${JSON.stringify(backlog.map(w => ({ id: w.id, title: w.title, surfaces: w.surfaces })))}
   ${A.calibration?.length ? `Memory estimate calibration — apply these factors to your token estimates and say so in the evidence: ${JSON.stringify(A.calibration)}` : 'No Memory calibration exists yet; estimate from the code and say the estimate is uncalibrated.'}
   metric_impacted must be one of ${JSON.stringify(metricNames)} verbatim, or "" when the opportunity honestly
   moves none of them. Do not force a binding — an unmetricked opportunity is real information and the verdict
   downstream is corrupted by a fake one.
   title and intent are what this becomes if the human approves it at the Roadmap Gate: an imperative title under
   120 characters and one paragraph a Spec Writer could work from.`,
  { label: 'opportunity_synthesizer', phase: 'Synthesize', model: MODEL.strong, ...AT('opportunity-synthesizer'), schema: Synthesis })
if (!synth) return refuse('opportunity synthesizer returned nothing')
log(`${synth.opportunities.length} opportunities synthesized`)

// =====================================================================
phase('Rank')
// ---- Prioritizer: code, 0 tokens (§5.1). value x confidence / cost, then the budget cut. ----
const costUnits = (c) => Math.max(1, (c?.tokens ?? 0) / 1000 + (c?.human_min ?? 0) * HUMAN_MIN_PER_1K)
const scored = synth.opportunities
  .map(o => ({ ...o, score: (o.expected_value * o.confidence) / costUnits(o.estimated_cost) }))
  .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

const budgetTokens = brief.budget?.tokens ?? 0
const remainingTokens = Math.max(0, budgetTokens - (burn.tokens ?? 0))
// Walk the ranked list and record where the cut fell. within_budget is a field, not array position, because a
// list split into one file per opportunity loses its order and must not lose the cut.
let spent = 0
const ranked = scored.map((o, i) => {
  const t = o.estimated_cost?.tokens ?? 0
  const fits = burn.found && spent + t <= remainingTokens
  if (fits) spent += t
  return {
    id: o.id, project_id: project, hypothesis: o.hypothesis, evidence: o.evidence,
    metric_impacted: o.metric_impacted, expected_value: o.expected_value,
    estimated_cost: o.estimated_cost, confidence: o.confidence, surfaces: o.surfaces ?? [],
    score: Number(o.score.toFixed(6)), rank: i + 1, within_budget: fits,
    provenance: stamp('prioritizer', 'n/a', 'dark_factory'),
  }
})
const within = ranked.filter(o => o.within_budget)
log(`ranked ${ranked.length}; ${within.length} inside the remaining ${remainingTokens.toLocaleString()} token budget${burn.found ? '' : ' (burn UNKNOWN — nothing marked within_budget)'}`)

// ---- Verdict Evaluator, numbers half: code (§5.1 "code for the numbers"). ----
// Target grammar the code will parse. Anything else is unparseable and says so rather than guessing.
const parseTarget = (t) => {
  const m = String(t).trim().match(/^(>=|<=|>|<|=)?\s*([0-9]+(?:\.[0-9]+)?)/)
  return m ? { op: m[1] ?? '>=', n: Number(m[2]) } : null
}
const readingOf = new Map((usage.metric_readings ?? []).map(r => [r.metric, r]))
const unmeasured = []
const metricsVsTargets = (brief.success_metrics ?? []).map(sm => {
  const r = readingOf.get(sm.metric)
  const parsed = parseTarget(sm.target)
  let met = false, actual
  if (!r || !r.measured || r.actual_number === null || r.actual_number === undefined) {
    actual = r?.actual_text || 'not measured in this period'
    unmeasured.push({ metric: sm.metric, why: !r ? 'no reading returned' : !r.measured ? 'telemetry does not cover it' : 'measured but not numeric' })
  } else if (!parsed) {
    actual = `${r.actual_text} (target "${sm.target}" is not a comparable expression)`
    unmeasured.push({ metric: sm.metric, why: `target "${sm.target}" does not parse as an inequality` })
  } else {
    const v = r.actual_number
    met = parsed.op === '>=' ? v >= parsed.n : parsed.op === '<=' ? v <= parsed.n
      : parsed.op === '>' ? v > parsed.n : parsed.op === '<' ? v < parsed.n : v === parsed.n
    actual = r.actual_text
  }
  // Unmeasured or unparseable is met=false, never met=true: a missing measurement must not be able to satisfy a
  // success metric. Nothing passes by default, in either direction.
  return { metric: sm.metric, target: String(sm.target), actual: String(actual), met }
})

const killHit = (killFacts?.criteria ?? []).filter(c => c.condition_occurred && c.determinable).map(c => c.criterion)
const undeterminable = (killFacts?.criteria ?? []).filter(c => !c.determinable).map(c => c.criterion)
const remainingBacklogValue = Number(
  // §5.2's parallel only holds under this reading: value is a property of the Opportunity[], not of the cut.
  synth.opportunities.reduce((s, o) => s + o.expected_value * o.confidence, 0).toFixed(4))
const projectedCost = within.reduce((s, o) => s + (o.estimated_cost?.tokens ?? 0), 0) / 1000
const allMet = metricsVsTargets.length > 0 && metricsVsTargets.every(m => m.met)
const budgetExhausted = burn.found && remainingTokens <= 0

// §5.3, in order. Each branch names the rule that fired so the rationale can cite it.
let recommendation, rule
if (killHit.length) {
  recommendation = within.length ? 'pivot' : 'kill'
  rule = `kill_criteria hit (${killHit.length}) → §5.3 forces kill or pivot; ${within.length ? 'backlog still has funded work, so pivot' : 'no funded work remains, so kill'}`
} else if (burn.found && remainingBacklogValue < projectedCost) {
  recommendation = allMet ? 'sell' : 'kill'
  rule = `remaining_backlog_value (${remainingBacklogValue}) < projected cost (${projectedCost.toFixed(1)}) → §5.3 forces sell or kill; ${allMet ? 'all metrics met, so sell' : 'metrics unmet, so kill'}`
} else if (allMet) {
  recommendation = within.length ? 'keep' : 'sell'
  rule = `all ${metricsVsTargets.length} success metrics met → §5.3 allows keep or sell; ${within.length ? 'funded backlog remains, so keep' : 'nothing funded remains, so sell'}`
} else {
  recommendation = 'keep'
  rule = `no kill criterion hit, backlog value (${remainingBacklogValue}) covers projected cost, ${metricsVsTargets.filter(m => m.met).length}/${metricsVsTargets.length} metrics met → keep`
}

// ---- Verdict Evaluator, rationale half: an agent, and it is handed the recommendation, never asked for one. ----
const rationale = await agent(
  `Write the rationale a human reads at the Roadmap Gate. The recommendation was DERIVED IN CODE and is given to
   you below — you explain it, you never choose it and never argue for a different one.
   Recommendation: ${recommendation}
   Rule that fired: ${rule}
   metrics_vs_targets: ${JSON.stringify(metricsVsTargets)}
   Metrics that could not be measured or whose target does not parse — name these, an unmeasured metric is neither
   met nor missed: ${JSON.stringify(unmeasured)}
   kill_criteria hit: ${JSON.stringify(killHit)}
   kill_criteria that could not be determined from the inputs: ${JSON.stringify(undeterminable)}
   remaining_backlog_value: ${remainingBacklogValue} (sum of expected_value x confidence over all opportunities)
   burn: ${JSON.stringify(burn)}${burn.found ? '' : ' — the ledger read FAILED, so every budget statement below is unknown, not zero'}
   budget_exhausted: ${budgetExhausted}
   ranked opportunities: ${JSON.stringify(ranked.map(o => ({ rank: o.rank, id: o.id, hypothesis: o.hypothesis, score: o.score, within_budget: o.within_budget, metric_impacted: o.metric_impacted })))}
   ProjectBrief budget: ${JSON.stringify(brief.budget)}
   If any number above looks wrong or contradicts another, say so plainly in the rationale — and still do not
   change the recommendation.`,
  { label: 'verdict_rationale', phase: 'Rank', model: MODEL.mid, ...AT('verdict-rationale'), schema: Rationale })

const verdict = {
  project_id: project,
  recommendation,
  metrics_vs_targets: metricsVsTargets,
  kill_criteria_hit: killHit,
  remaining_backlog_value: remainingBacklogValue,
  burn: { tokens: burn.tokens ?? 0, dollars: burn.dollars ?? 0, human_hours: Number(((burn.human_min ?? 0) / 60).toFixed(2)) },
  rationale: rationale?.rationale ?? `${rule}. (Rationale agent returned nothing; this is the code's own rule text, unedited.)`,
  provenance: stamp('verdict_evaluator', MODEL.mid, 'dark_factory'),
}

// ---- Draft WorkItems: a code edge, not the Backlog Emitter. These are what the human SELECTS from at the gate;
//      the Emitter runs on the far side of it, on the selection. ----
const draftWorkItems = ranked.map((o, i) => {
  const s = synth.opportunities.find(x => x.id === o.id)
  return {
    id: `wi-${o.id}`, project_id: project, source: 'improve',
    title: s.title, intent: s.intent,
    priority: i + 1, deferred_iterations: 0,
    budget: { tokens: o.estimated_cost?.tokens ?? 0, wall_clock_min: Math.max(5, Math.round((o.estimated_cost?.tokens ?? 0) / 10000)) },
    surfaces: o.surfaces,
    provenance: stamp('backlog_emitter:draft', 'n/a', 'dark_factory'),
  }
})

return {
  opportunities: ranked,
  verdict,
  draft_work_items: draftWorkItems,
  unmeasured,
  undeterminable_kill_criteria: undeterminable,
  burn,
  duplicates: synth.opportunities.filter(o => o.duplicate_of).map(o => ({ opportunity: o.id, duplicate_of: o.duplicate_of })),
  gate: {
    gate: 'roadmap_gate',
    options: ['keep', 'sell', 'kill', 'pivot'],
    next: 'build-reentry',
    payload_ref: `${DIR}/gate-payload.json`,
    note: 'ONE record (§5.2: the human decides ranking and verdict in one sitting). decision.option = the verdict; decision.selection = approved Opportunity ids.',
  },
  refs: { dir: DIR, telemetry: A.telemetry_ref, feedback: A.feedback_ref },
  provenance: stamp('improve-analyze', 'n/a', 'hitl'),
}
