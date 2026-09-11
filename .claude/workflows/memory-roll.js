export const meta = {
  name: 'memory-roll',
  description: 'Company Memory (OPERATING_MODEL §8): run history → patterns, estimate calibration, per-lens catch rates, a canary library build-implement can consume, and the Method Ledger report. Dark Factory sink, zero gates, nothing waits on it.',
  phases: [
    { title: 'Read', detail: 'panel/lens counts ∥ method+model ledger rows ∥ pattern extraction ∥ canary candidates — four independent reads' },
    { title: 'Roll', detail: 'code, 0 tokens: calibration factors, catch rates (or an honest null), method report, review queue' },
  ],
}

// args: { project_id, run_id, now, period: { from, to },
//         runs_dir? ('ledger/runs'), ledger_index? ('ledger/index.jsonl'),
//         artifact_dir?, agent_types?: false,
//         planted_defects?: [{ id, note }],   // defects planted by hand, so they are EXCLUDED from catch rates by name
//         known_causes?: [{ signal_id, suspect_commit }] }   // Maintain causes, for the escaped-defect join
// returns: MemoryRoll (see contracts.schema.json)
//
// Human touchpoints: NONE. §8 is a Dark Factory sink and is never on a critical path, so there is no gate here and
// no workflow boundary after it. The one thing that looks like a touchpoint is not one: §2.4.4 sends a lens that
// passed a canary to a "human review queue", which is HOTL — it lands in a queue and the run proceeds. There is no
// review-queue substrate today (gates/ is HITL only), so it is carried out in MemoryRoll.review_queue instead.
//
// Post-run protocol for the main session:
//   1. node substrate/lib/run-output.js <task output> --save /tmp/<run>.json
//   2. node substrate/ledger.js append --workflow memory-roll --run <run_id> --started <args.now> ... --tokens-by-model '{...}'
//   3. node -e "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync('/tmp/<run>.json','utf8'));const d='.artifacts/memory/<run_id>';
//        fs.mkdirSync(d,{recursive:true});fs.writeFileSync(d+'/roll.json',JSON.stringify(o.roll,null,2)+'\n')"
//      then node substrate/validator.js MemoryRoll .artifacts/memory/<run_id>/roll.json
//
// Design notes, because §8 is mostly missing edges rather than missing nodes:
//   1. THE LENS CALIBRATOR HAS NO INPUT EDGE IN THE DATA. §8 wants "PanelResult[] vs defects found later in
//      Maintain". The join is Cause.suspect_commit (a sha, which exists) -> the run that produced that commit ->
//      that run's EvidenceBundle.panel_results. The middle hop does not exist: nothing records the commit a run
//      shipped. EvidenceBundle.artifact_ref is a BRANCH NAME, which dies with its container — the same disease as
//      WorkItem.branch. contracts.schema.json now carries an optional EvidenceBundle.integration_commit that would
//      close it; nothing stamps it yet. Until something does, catch_rate is null with unavailable_reason set.
//      A null is the honest answer. A percentage computed off a denominator of zero is not.
//   2. Defects planted by hand on a branch no Verifier Panel ever saw are NOT lens misses. Phase 4's two are the
//      case in point. They are excluded by id via args.planted_defects and the exclusion is reported, not silent.
//   3. The Canary Injector's "waits on nothing" is false: §8 has it receive a known-defect library that nothing in
//      §8 produces. Its only honest sources are Maintain's causes and the Calibrator's misses, so it runs off the
//      same run history everything else here reads.
//   4. The Estimate Calibrator's edge is real but unfed. Provenance.tokens exists and is optional; the runtime
//      exposes no per-agent count, so no script has ever stamped it. basis is therefore 'run_level' and node-level
//      calibration is reported as unavailable rather than faked.
//   5. The Method Ledger's "x outcome" has no outcome field. LedgerEntry carries status and escalations only.
//      outcomes therefore carries what is actually recorded and omits what is not — an absent key means not
//      measured, never zero.

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
const RUNS = A.runs_dir ?? 'ledger/runs'
const INDEX = A.ledger_index ?? 'ledger/index.jsonl'
const LENSES = ['spec_conformance', 'security', 'correctness']
const planted = A.planted_defects ?? []
const knownCauses = A.known_causes ?? []

// ---- inlined contracts (runtime forbids import; keep in sync with contracts.schema.json) ----
const PanelFacts = { type: 'object', additionalProperties: false, required: ['runs_read', 'lenses', 'panels_total'],
  properties: {
    runs_read: { type: 'array', items: { type: 'string' } },
    panels_total: { type: 'integer', minimum: 0 },
    lenses: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['lens', 'panels_seen', 'verdict_pass', 'verdict_fail', 'findings_raised'],
      properties: { lens: { type: 'string' }, panels_seen: { type: 'integer', minimum: 0 },
        verdict_pass: { type: 'integer', minimum: 0 }, verdict_fail: { type: 'integer', minimum: 0 },
        findings_raised: { type: 'integer', minimum: 0 },
        findings_overruled: { type: 'integer', minimum: 0 },
        min_attempts_seen: { type: 'integer', minimum: 0 } } } },
    note: { type: 'string' } } }
const MethodRows = { type: 'object', additionalProperties: false, required: ['rows', 'models', 'found'],
  properties: {
    found: { type: 'boolean' },
    rows: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['key', 'runs', 'tokens', 'cost_est_usd'],
      properties: { key: { type: 'string' }, runs: { type: 'integer', minimum: 0 },
        tokens: { type: 'integer', minimum: 0 }, cost_est_usd: { type: 'number', minimum: 0 },
        human_min: { type: 'integer', minimum: 0 }, escalations: { type: 'integer', minimum: 0 },
        wall_clock_sec: { type: 'integer', minimum: 0 } } } },
    models: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['key', 'tokens', 'cost_est_usd'],
      properties: { key: { type: 'string' }, runs: { type: 'integer', minimum: 0 },
        tokens: { type: 'integer', minimum: 0 }, cost_est_usd: { type: 'number', minimum: 0 } } } },
    note: { type: 'string' } } }
const Estimates = { type: 'object', additionalProperties: false, required: ['rows', 'node_tokens_available'],
  properties: {
    node_tokens_available: { type: 'boolean', description: 'whether ANY stored artifact carries provenance.tokens' },
    rows: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['work_type', 'estimated_tokens', 'actual_tokens', 'evidence_runs'],
      properties: { work_type: { type: 'string' }, estimated_tokens: { type: 'integer', minimum: 0 },
        actual_tokens: { type: 'integer', minimum: 0 }, evidence_runs: { type: 'array', items: { type: 'string' } } } } },
    note: { type: 'string' } } }
const Extraction = { type: 'object', additionalProperties: false, required: ['patterns', 'canaries'],
  properties: {
    patterns: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'kind', 'claim', 'evidence_runs', 'sample_size'],
      properties: { id: { type: 'string' }, kind: { enum: ['pattern', 'prompt_refinement', 'anti_pattern'] },
        claim: { type: 'string' }, evidence_runs: { type: 'array', minItems: 1, items: { type: 'string' } },
        sample_size: { type: 'integer', minimum: 1 } } } },
    canaries: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'defect_class', 'mutation', 'origin', 'expected_lens'],
      properties: { id: { type: 'string' }, defect_class: { type: 'string' }, mutation: { type: 'string' },
        origin: { type: 'string' }, expected_lens: { type: 'string' } } } },
    note: { type: 'string' } } }

// =====================================================================
phase('Read')
// Four reads with no path between any two. The barrier is real: every roll-up below needs all of them.
const [panelFacts, methodRows, estimates, extraction] = await parallel([
  () => agent(`Run this from the repository root and report exactly what it prints. Do not interpret, recompute or tidy the numbers.

node -e "const fs=require('node:fs');const d='${RUNS}';const out={runs_read:[],panels_total:0,lenses:{}};
for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.json'))){const o=JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));
const prs=o.result&&o.result.panel_results;if(!prs)continue;out.runs_read.push(o.run_id||f.replace(/\\.json$/,''));
for(const pr of prs){out.panels_total++;for(const v of (pr.verdicts||[])){const L=out.lenses[v.lens]||(out.lenses[v.lens]={lens:v.lens,panels_seen:0,verdict_pass:0,verdict_fail:0,findings_raised:0,findings_overruled:0,min_attempts_seen:99});
L.panels_seen++;if(v.verdict==='pass')L.verdict_pass++;else L.verdict_fail++;L.findings_raised+=(v.findings||[]).length;
L.findings_overruled+=(v.findings||[]).filter(x=>x.status==='overruled').length;L.min_attempts_seen=Math.min(L.min_attempts_seen,(v.attempts||[]).length);}}}
out.lenses=Object.values(out.lenses);console.log(JSON.stringify(out,null,1))"

Copy its output into the schema verbatim. If the command fails, return panels_total 0, lenses [], runs_read [] and
the error text in note — never substitute a different command or estimate the counts.`,
    { label: 'panel_facts', phase: 'Read', model: MODEL.cheap, ...AT('mechanical'), schema: PanelFacts }),

  () => agent(`Run these two from the repository root and report exactly what they print:
  node substrate/ledger.js summary --by method
  node substrate/ledger.js summary --by model
Put the --by method rows in "rows" and the --by model rows in "models", one object per printed row, key = the row's
first column. Copy every number verbatim; never recompute or round. If a column the schema asks for is not printed,
omit that field rather than inventing it. If either command fails, found=false and the error text in note.`,
    { label: 'method_rows', phase: 'Read', model: MODEL.cheap, ...AT('mechanical'), schema: MethodRows }),

  () => agent(`Estimate calibration input: compare what work was BUDGETED against what it actually cost.
Read the stored run results under ${RUNS}/ and the ledger index at ${INDEX}.
For each build-spec/build-implement run you can pair up, report the work type (use the WorkItem.source that drove it —
"maintain_patch", "improve", "brief" — or the workflow name when the source is not recorded), the budgeted token figure
if one is recorded (WorkItem.budget.tokens or args budget), the actual tokens from the ledger row, and evidence_runs.
Report ONLY pairs where you can read BOTH numbers. A row with a guessed estimate is worse than no row.
Also set node_tokens_available: true only if you find at least one stored artifact whose provenance carries a
"tokens" field. Check; do not assume. Compute no factors or ratios — that is done in script code.`,
    { label: 'estimate_inputs', phase: 'Read', model: MODEL.cheap, ...AT('memory-analyst'), schema: Estimates }),

  () => agent(`Read the stored run results under ${RUNS}/ and the repo, and extract two things.

PATTERNS — what has actually recurred across runs. Every pattern carries evidence_runs and an honest sample_size.
  kind "pattern" = something that worked and could be reused. "anti_pattern" = something that cost money or time and
  should not be repeated. "prompt_refinement" = a specific wording change to a workflow or agent prompt, with the run
  that motivated it. A claim you can only point at ONE run for has sample_size 1 and must be phrased as the single
  observation it is — never as a tendency.

CANARIES — deliberate defects that would test whether the Verifier Panel is awake. Draw them from defects that were
  REALLY seen in this repo's history (cite the run or signal id in origin); mark anything you invent origin:"synthetic".
  mutation must be a concrete instruction that could be applied to the toy app verbatim, because /build-implement
  passes it straight through to an implementer — e.g. "in toy/src/app.js, replace the q needle with a call to an
  identifier that is never defined". expected_lens names the lens that SHOULD catch it; if no current lens would be
  expected to, say so in defect_class, because that is a gap in the panel and worth more than a canary nobody is graded on.

Report only what you can cite. Compute no rates.`,
    { label: 'extraction', phase: 'Read', model: MODEL.cheap, ...AT('memory-analyst'), schema: Extraction }),
])

const pf = panelFacts ?? { runs_read: [], panels_total: 0, lenses: [], note: 'panel facts read returned nothing' }
const mr = methodRows ?? { found: false, rows: [], models: [], note: 'ledger read returned nothing' }
const est = estimates ?? { rows: [], node_tokens_available: false, note: 'estimate read returned nothing' }
const ex = extraction ?? { patterns: [], canaries: [], note: 'extraction returned nothing' }
log(`${pf.panels_total} panels across ${pf.runs_read.length} runs; ${mr.rows.length} method rows; ${ex.patterns.length} patterns; ${ex.canaries.length} canary candidates`)

// =====================================================================
phase('Roll')   // every number below is script code; agents above were detectors only

// ---- Estimate Calibrator (code). factor = actual / estimated. ----
const byType = new Map()
for (const r of est.rows ?? []) {
  if (!r.estimated_tokens || r.estimated_tokens <= 0) continue
  const e = byType.get(r.work_type) ?? { est: 0, act: 0, n: 0, runs: [] }
  e.est += r.estimated_tokens; e.act += r.actual_tokens; e.n++; e.runs.push(...(r.evidence_runs ?? []))
  byType.set(r.work_type, e)
}
const calibration = [...byType.entries()].map(([work_type, e]) => ({
  work_type, estimated_tokens: e.est, actual_tokens: e.act,
  factor: Number((e.act / e.est).toFixed(3)), sample_size: e.n,
  basis: est.node_tokens_available ? 'node_level' : 'run_level',
}))
if (!calibration.length) {
  calibration.push({
    work_type: '(none)', factor: 1, sample_size: 0, basis: 'run_level',
    estimated_tokens: 0, actual_tokens: 0,
  })
}

// ---- Lens Calibrator (code). This is the one that must refuse to produce a number. ----
// A catch rate needs a denominator: defects that PASSED a panel and were later found by Maintain. Establish
// whether that denominator exists at all before dividing anything.
const plantedIds = planted.map(p => p.id)
const joinableCauses = knownCauses.filter(c => c.suspect_commit && !plantedIds.includes(c.signal_id))
// Nothing stamps EvidenceBundle.integration_commit yet, so even a joinable cause has nothing to join TO.
const joinPossible = false
const denominatorReason = joinPossible
  ? ''
  : `no escaped-defect denominator exists. A catch rate needs defects that passed a Verifier Panel and were later `
    + `found by Maintain. The join is Cause.suspect_commit -> the run that shipped that commit -> that run's `
    + `panel_results, and the middle hop is not recorded: EvidenceBundle.artifact_ref is a branch name, and the `
    + `optional EvidenceBundle.integration_commit that would close it is stamped by nothing. `
    + (plantedIds.length
      ? `${plantedIds.length} defect(s) (${plantedIds.join(', ')}) were planted by hand on a branch no panel ever saw; `
        + `they are NOT lens misses and are excluded by name rather than counted.`
      : `No candidate escaped defects were supplied.`)

const lensRow = new Map((pf.lenses ?? []).map(l => [l.lens, l]))
const lensCatchRates = LENSES.map(lens => {
  const l = lensRow.get(lens) ?? { panels_seen: 0, findings_raised: 0, findings_overruled: 0 }
  const upheld = Math.max(0, (l.findings_raised ?? 0) - (l.findings_overruled ?? 0))
  return {
    lens,
    panels_seen: l.panels_seen ?? 0,
    findings_raised: l.findings_raised ?? 0,
    findings_upheld: upheld,
    escaped_defects_attributable: 0,
    catch_rate: null,
    unavailable_reason: denominatorReason,
  }
})

// A lens that has seen panels and raised nothing is not a catch rate, but it IS worth a human's eye (§2.4.5:
// "a lens that passes everything and catches nothing is measurably broken"). That goes to the review queue, which
// is HOTL — it does not stop anything.
const reviewQueue = []
for (const r of lensCatchRates) {
  if (r.panels_seen >= 3 && r.findings_raised === 0) {
    reviewQueue.push(`lens:${r.lens} — ${r.panels_seen} panels, 0 findings raised. Not proof of rubber-stamping (the changes may simply have been correct), but it is the shape §2.4.5 says to watch, and there is no catch rate to settle it. Run a canary against this lens.`)
  }
}
for (const l of pf.lenses ?? []) {
  if (typeof l.min_attempts_seen === 'number' && l.min_attempts_seen < 3 && l.min_attempts_seen >= 0 && l.panels_seen > 0) {
    reviewQueue.push(`lens:${l.lens} — a verdict was returned with only ${l.min_attempts_seen} attempts; §2.4.1 requires at least 3 and the tool layer is supposed to reject fewer.`)
  }
}
if (!ex.canaries?.length) {
  reviewQueue.push('canary library is empty: /build-implement has a canary arg that nothing has ever exercised, so the panel has never been graded on a known defect.')
}

// ---- Method Ledger (code). provenance.method x outcome x cost. ----
const modelOf = new Map((mr.models ?? []).map(m => [m.key, m]))
const methodReport = (mr.rows ?? []).map(r => {
  const row = {
    method: r.key, runs: r.runs ?? 0, tokens: r.tokens ?? 0,
    cost_est_usd: Number((r.cost_est_usd ?? 0).toFixed(4)),
    escalations: r.escalations ?? 0,
    outcomes: {},
  }
  if (typeof r.human_min === 'number') row.human_min = r.human_min
  // LedgerEntry records status and escalations and nothing else about how a run turned out, so `outcomes` carries
  // those two and omits shipped / vetoed / came-back-as-a-defect entirely. An absent key means NOT MEASURED.
  row.outcomes.runs_ok = r.runs ?? 0
  row.outcomes.escalated = r.escalations ?? 0
  return row
})
const methodNote = mr.found === false
  ? 'ledger read FAILED; the method report is empty rather than zero'
  : `outcomes carries runs_ok and escalated only. LedgerEntry has no outcome field, so "did it ship", "was it vetoed" and "did it come back as a defect" are NOT MEASURED — and that is the question §8 says the whole model exists to answer.`

// Models are priced separately because tokens are not comparable across tiers (substrate/README).
const modelReport = (mr.models ?? []).map(m => ({ model: m.key, tokens: m.tokens ?? 0, cost_est_usd: Number((m.cost_est_usd ?? 0).toFixed(4)) }))

const patterns = (ex.patterns ?? []).map(p => ({
  id: p.id, kind: p.kind, claim: p.claim, evidence_runs: p.evidence_runs, sample_size: p.sample_size,
}))
const canaries = (ex.canaries ?? []).map(c => ({
  id: c.id, defect_class: c.defect_class, mutation: c.mutation, origin: c.origin, expected_lens: c.expected_lens,
}))

log(`calibration ${calibration.length} row(s), basis ${calibration[0].basis}; catch rates unavailable for all ${lensCatchRates.length} lenses; ${reviewQueue.length} review-queue item(s)`)

// The roll is returned as its own key so the main session can write it straight to disk and validate it as a
// MemoryRoll. Anything that is not part of the contract goes in `aux` — never inside the artifact.
return {
  roll: {
    project_id: A.project_id,
    period: A.period,
    runs_read: pf.runs_read ?? [],
    patterns,
    calibration,
    lens_catch_rates: lensCatchRates,
    canaries,
    method_report: methodReport,
    review_queue: reviewQueue,
    provenance: stamp('memory-roll', 'n/a', 'dark_factory'),
  },
  aux: {
    model_report: modelReport,
    method_note: methodNote,
    panels_total: pf.panels_total ?? 0,
    lens_facts: pf.lenses ?? [],
    excluded_planted_defects: planted,
    notes: [pf.note, mr.note, est.note, ex.note].filter(Boolean),
  },
  provenance: stamp('memory-roll', 'n/a', 'dark_factory'),
}
