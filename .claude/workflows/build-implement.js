export const meta = {
  name: 'build-implement',
  description: 'Implement approved specs: implementer and test author in parallel per task, adversarial verifier panel, converging fix loop, one integration barrier, evidence bundle out.',
  phases: [{ title: 'Implement+Verify', detail: 'per task: implementer ∥ test author → panel → fix loop' }, { title: 'Integrate', detail: 'the one barrier' }, { title: 'Evidence', detail: 'assembled by code' }],
}

// args: { repo, project_id, iteration, specs: [{spec, graph, spec_ref?}], run_id, now,
//   spec_ref: path to the full Spec JSON in the artifact store. When present, agents read it there and only a summary
//             (id, goal, touched_surfaces, out_of_scope) is inlined (CLAUDE.md rule 4: large artifacts cross edges by ref).
//         budget?: { task_tokens, round_tokens }, k_rounds?, artifact_dir?, base?,
//         canary?: { task_id? | spec_id?, mutation: string }, test_hint?: string, run_hint?: string, max_fixers? (default 4) }
//   work_item_budgets?: { [work_item_id]: { tokens } } — optional, additive. A WorkItem's token budget, split evenly
//         across that work item's tasks in THIS run to give each task a per-task ceiling; absent, falls back to
//         budget.task_tokens (default 250000). A per-round ceiling defaults to that ceiling / k_rounds unless
//         budget.round_tokens overrides it. A round that breaches either ceiling escalates with reason "budget"
//         between rounds (never mid-round), checked before max_rounds.
//   test_dir: where landed TestSets go, relative to the worktree root (default "<repo>/test"). The repo's own test
//         runner must actually pick this glob up — for venture-0 work on the plant, repo is "." and this is
//         "substrate/test". A test landed where the runner does not look is a green suite that proves nothing.
//   repo: a directory of THIS git repository (e.g. "toy"). Worktrees are of the repository at base (default HEAD),
//         one branch per task (task/<task_id>); the app is at <worktree>/<repo>/.
//   canary: a deliberate defect injected into one task's change set before verification (OPERATING_MODEL §2.4.4).
//   gate: { gate_id } — REQUIRED when any spec carries gate:"pending". The closed spec_gate record is read from
//         gates/ by a mechanical agent and must say decided/spec_gate/approve, or the run refuses. A decision in
//         args alone is never trusted.
//   verify_only: { [task_id]: { branch, base } } — re-panel an EXISTING branch: no implementer; a mechanical agent checks it out
//         and writes the diff base...branch; test author, panel, fix loop and integration run as usual. For re-verification
//         (r5's adjudication defect) and for Maintain. A re-run of an already-merged change is otherwise a zero-byte diff.
//   agent_types?: false — drops every agentType binding (a session that predates .claude/agents/ registering at all).
//   missing_agent_types?: [name] — names the agentTypes THIS run's runtime has not yet registered; AT() drops only those.
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
// .claude/agents/ definitions register from the COMMITTED tree, but NOT immediately: the runtime rescans on its own
// schedule, so an agent committed mid-session is unavailable to the next run and available some minutes later.
// agent_types:false drops every binding (a session that predates .claude/agents/ registering at all); missing_agent_types
// names the individual types THIS run's runtime has not yet registered, so AT() drops only those. When a type is
// dropped its ROLE PROMPT goes with it, so every constraint that matters is also stated inline in the prompts below.
const MISSING = new Set(A.missing_agent_types ?? [])
const AT = (t) => (A.agent_types === false || MISSING.has(t) ? {} : { agentType: t })
const APP = `${A.repo}`
// Where landed TestSets go, relative to the worktree root. Defaults to <repo>/test, which is right for an app like
// toy/. It is NOT right for venture-0 work on the plant itself: there repo is "." and the runner's glob is
// substrate/test/*.test.js, so a test landed in ./test/ would sit where nothing runs it — a green suite proving
// nothing. Pass test_dir explicitly whenever the app's test glob is not <repo>/test/.
const TEST_DIR = A.test_dir ?? `${APP}/test`
const VETO_LENS = 'security'
// Surfaces the boundary check never flags: transient artifact-store paths a diff should never contain in the
// first place, but the check is defensive rather than assuming that can never happen.
const EXEMPT_PREFIXES = [`${ART}/`]
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
    // Size of the file at diff_ref, as measured by the agent that wrote it. The script cannot stat a file, so the
    // emptiness decision has to travel on the ChangeSet or not exist at all.
    diff_bytes: { type: 'integer', minimum: 0 },
    touched_surfaces: { type: 'array', items: Surface }, notes: { type: 'string' }, revision: { type: 'integer' },
    // Optional (wi-b5): a value a sibling task's owned surface creates, asked for instead of invented. Routed to
    // boundaryRepair before any lens, test runner, fixer or empty-diff gate. Never required.
    needs_from_sibling: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['surface', 'what'], properties: { surface: { type: 'string' }, what: { type: 'string' } } } },
    // Optional (wi-b6): a Fixer's own report on its OWN fix. true when it changes what the code DOES; false when
    // it only renames, relabels or moves things without changing the behaviour a finding named. A false value for
    // a finding that cites a failing test is refused (fixRefused, in the sentinel block below) rather than
    // accepted — the fixer may not bend the code to fit a test's text.
    behaviour_changed: { type: 'boolean' }, behaviour_rationale: { type: 'string' } } }
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
    status: { enum: ['open', 'fixed', 'disputed', 'overruled', 'repeat'] },
    // Additive, optional. The lens sets it when it knows which artifact the fix belongs in; routeFinding falls
    // back to location only when it is absent. Never required — an older lens that never sets it keeps working.
    target: { enum: ['implementation', 'test'] } } }
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
    reason: { enum: ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro'] },
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
    tests_found: { type: 'array', items: { type: 'string' }, description: 'EVERY .js basename found across the TestSet paths, before any copying. Reconciled in script against tests_landed + tests_skipped: a short list is how a TestSet silently half-lands.' },
    tests_landed: { type: 'array', items: { type: 'string' }, description: 'TestSet files copied into the repo test dir and committed' },
    tests_skipped: { type: 'array', items: { type: 'string' }, description: 'TestSet files NOT copied because a file of that name already exists. Reported, never overwritten.' } } }

// ---- wi-b6: test validity before blame ----
// The detector's own report: facts only, never a verdict — the class is derived in script code by the PURE
// testValidity function below, never voted on by an agent (out_of_scope: "Letting an agent vote on a failing
// test's class").
const TestValidityFacts = { type: 'object', additionalProperties: false,
  required: ['test', 'criterion', 'locates_by_first_occurrence', 'requires_unquoted_literal', 'fails_on_base_same_reason', 'names_criterion_behaviour'],
  properties: { test: { type: 'string' }, criterion: { type: 'string' },
    locates_by_first_occurrence: { type: 'boolean' }, requires_unquoted_literal: { type: 'boolean' },
    fails_on_base_same_reason: { type: 'boolean' }, names_criterion_behaviour: { type: 'boolean' } } }
const TestValidityReport = { type: 'object', additionalProperties: false, required: ['tests'],
  properties: { tests: { type: 'array', items: TestValidityFacts } } }
// Emitted in the run output (AC-11): one entry per classification made, whatever produced it — the detector's
// facts, or a refused fixer's behaviour_changed:false (AC-13, whose `facts` is { behaviour_changed: false }
// instead of the detector's four booleans; deliberately an open object rather than a second named shape).
const TestValidityEntry = { type: 'object', additionalProperties: false, required: ['test', 'criterion', 'facts', 'class'],
  properties: { test: { type: 'string' }, criterion: { type: 'string' }, facts: { type: 'object' },
    class: { enum: ['test_defect', 'code_defect', 'unclear'] } } }
// TestRepair: unchanged shape, reused by the detector's test_defect route and by a refused fix's re-route, in
// addition to its original use in the fix loop below. Declared once, here, so every caller shares one definition.
const TestRepair = { type: 'object', additionalProperties: false, required: ['tests_ref', 'criteria_coverage'],
  properties: { tests_ref: { type: 'string' }, criteria_coverage: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }

// ---- pure-code edges ----
const dedupe = (fs) => [...new Map(fs.map(f => [f.dedupe_key, f])).values()]

// A verdict is derived from its findings, not declared beside them (r8: correctness listed a high-severity defect and said pass).
// Findings are defects only, so any finding other than a SPEC-LEVEL note makes the lens a fail. Code decides; the lens only detects.
const SPEC_LEVEL = /^SPEC-LEVEL:/
// Fully derived, both directions: a lens's self-declared verdict never overrides what its own findings show.
// The "pass but listed a defect" direction is r8's fix; the "fail but carries no defect" direction is needed now
// that stripForeignFindings can remove every defect a lens raised (AC-11) — a lens that failed ONLY on a
// sibling-owned criterion must read as pass once that finding is gone, not stay failed on its own say-so.
function normalizeVerdict(v, tag) {
  const defects = (v.findings ?? []).filter(f => !SPEC_LEVEL.test(String(f.claim)))
  const derived = defects.length ? 'fail' : 'pass'
  if (v.verdict !== derived) {
    log(`${tag} ${v.lens}: said ${v.verdict} but ${defects.length} defect(s) remain; recorded as ${derived}`)
    return { ...v, verdict: derived }
  }
  return v
}

// Lenses receive DIFFERENT inputs (OPERATING_MODEL §2.4): they are independent detectors, not redundant voters, so there is
// no majority rule. Security is a veto. Any other confident fail fails the panel. A fail held only at low confidence
// (every failing lens < 0.7) goes to the Tiebreak Judge. r5 shipped four tasks over a failing lens under the old majority rule.
const LOW_CONFIDENCE = 0.7
// Parameter named panelVerdicts, not verdicts, so this declaration's text differs from the call site further
// down in the verify loop.
function adjudicate(panelVerdicts) {
  const veto = panelVerdicts.find(v => v.lens === VETO_LENS && v.verdict === 'fail')
  if (veto) return { result: 'fail', veto_by: veto.lens, split: false }
  const fails = panelVerdicts.filter(v => v.verdict === 'fail')
  if (!fails.length) return { result: 'pass', split: false }
  if (fails.every(v => v.confidence < LOW_CONFIDENCE)) return { result: null, split: true }
  return { result: 'fail', split: false }
}

// ---- BEGIN fix-loop decisions ----
// Pure decisions for the verify-fix loop. No runtime handle crosses in (everything the loop knows is passed as a
// plain value) and nothing here waits on anything, so a test can cut this block out and evaluate it standalone.

// A location is "path:line" or "path:line:col"; a non-path (a route, a bare word) is reported as not-a-file.
// An absolute path or one with a ".." or "." segment is also reported as not-a-file: every caller of scopeOf
// joins the result onto a worktree/artifact-dir prefix and hands it to an agent as a place to read or write, so a
// finding location that tries to walk out of that prefix (e.g. "../../etc/passwd:10") must never come back as a
// usable scope — it is not a path this loop is allowed to touch, exactly like a bare route or word is not a path.
function scopeOf(location) {
  let s = String(location ?? '').trim()
  s = s.replace(/(:\d+){1,2}\s*$/, '').trim()
  if (!s || /\s/.test(s)) return ''
  if (s.startsWith('/') || s.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(s)) return ''
  if (s.split(/[\\/]/).some(seg => seg === '..' || seg === '.')) return ''
  return s
}

// Distinct files, first-seen order, non-file locations dropped: exactly the set a slicer needs to cut patches for.
function scopeTargets(findings) {
  const files = []
  const seenFiles = new Set()
  for (const f of findings ?? []) {
    const file = scopeOf(f?.location)
    if (file && !seenFiles.has(file)) { seenFiles.add(file); files.push(file) }
  }
  return files
}

// Re-panel by finding resolution, not by verdict: a lens re-runs only if it raised a finding that was fixed, upheld
// on dispute, deferred past the fixer cap, or otherwise left unresolved. A lens whose every finding was overruled is
// settled for this change set — it re-joins the panel only through the existing confirm pass, never a fresh retry.
function nextLenses({ lenses, findings, resolution, mode, verified }) {
  if (mode === 'all') return { retry: [...lenses], settled: [] }
  const byLens = new Map()
  for (const f of findings ?? []) {
    if (!byLens.has(f.lens)) byLens.set(f.lens, [])
    byLens.get(f.lens).push(f)
  }
  const res = resolution ?? {}
  const retry = [], settled = []
  for (const l of lenses ?? []) {
    const raised = byLens.get(l)
    if (!raised || !raised.length) continue
    const allOverruled = raised.every(f => res[f.dedupe_key] === 'overruled')
    if (allOverruled) settled.push(l); else retry.push(l)
  }
  return { retry, settled }
}

// The escape hatch (mode "all") runs the whole panel until green. Otherwise: outstanding failures win; with none
// outstanding, only lenses not yet verified against the current change set are confirmed. Empty means leave the loop.
function lensesToRun({ lenses, retry, verified, mode }) {
  if (mode === 'all') return [...(lenses ?? [])]
  if (retry && retry.length) return [...retry]
  const done = new Set(verified ?? [])
  return (lenses ?? []).filter(l => !done.has(l))
}

// Per-round ceiling: an explicit override wins; otherwise the task ceiling split evenly across the rounds it gets,
// never below one token, and a missing or zero round count degrades to the whole task ceiling rather than a divide-by-zero.
function roundBudget({ task_tokens, k_rounds, round_tokens }) {
  if (round_tokens != null) return Math.max(1, round_tokens)
  if (!k_rounds) return Math.max(1, task_tokens)
  return Math.max(1, Math.floor(task_tokens / k_rounds))
}

// Per-task ceiling: a WorkItem token allotment supplied by the caller splits evenly across that work item's tasks
// in this run; an absent or zero allotment falls back to the default, so a caller passing nothing sees today's number.
function taskCeiling({ work_item_tokens, tasks_for_work_item, default_task_tokens }) {
  if (work_item_tokens) return Math.floor(work_item_tokens / Math.max(1, tasks_for_work_item || 1))
  return default_task_tokens
}

// A lens that fails round after round is not converging, whatever its findings call themselves. The seen-set keys
// on dedupe_key, so a defect that RENAMES ITSELF between rounds slips repeat_finding entirely: run t4i spent three
// rounds and ~$2.72 on three variants of one acceptance criterion, each carrying a fresh key, and died on the round
// cap instead of the repeat stop. A per-lens consecutive-failure streak sees the shape the keys hide.
// Only lenses that actually ran are scored; a lens that sat out a round keeps its streak rather than having it reset.
function lensStreaks(prev, lensesRun, findings) {
  const failing = new Set((findings ?? []).map(f => f.lens))
  const next = { ...(prev ?? {}) }
  for (const l of lensesRun ?? []) next[l] = failing.has(l) ? (next[l] ?? 0) + 1 : 0
  return next
}

// The first lens at or past the cap, or null. Keys are walked in insertion order, so the same run names the same lens.
function stuckLens(streaks, cap) {
  for (const l of Object.keys(streaks ?? {})) if ((streaks[l] ?? 0) >= cap) return l
  return null
}

// At the round cap, findings that have never reached a fixer cost a whole panel and are thrown away unfixed — t4i
// escalated on the round that FIRST raised its open finding, with zero fix attempts on it. One grace round is
// granted for that case: once per task, only when every open finding is brand new, and never to a lens already on a
// failure streak (that lens is stuck, not unlucky). Bounded at one, or a renaming defect would extend forever.
function graceRound(ctx, findings) {
  if (ctx.grace_used) return false
  const open = findings ?? []
  if (!open.length) return false
  const seen = ctx.seen ?? new Set()
  if (!open.every(f => !seen.has(f.dedupe_key))) return false
  return !stuckLens(ctx.lens_streaks, ctx.k_rounds)
}

// What to do when the captured diff measures empty. Run t5i deadlocked here: task t2 depended on t1, t1's
// implementer had already written t2's owned surfaces, so t2 found its work done, committed nothing, and its branch
// stayed AT t1's head — git rev-parse showed task/t1 and task/t2 as the same ref and base...head was necessarily
// empty. With a 0-byte diff the lenses fell back to the repository root, where the work did not exist, while the
// fixer and test runner read the worktree, where it did. Both sides correct about different trees; no round could
// close it. The decision is taken from the ChangeSet BEFORE any lens, test runner or fixer is called, so an empty
// diff costs nothing instead of three rounds.
//   proceed   — there is a diff, or this is a legacy ChangeSet that never reported bytes and declared surfaces.
//   measure   — nothing reported and nothing declared: ask once rather than assume.
//   recapture — empty, but the task has dependencies, so the work may legitimately already sit in its base.
//                Re-diff against the RUN base, which shows the cumulative change, before concluding anything.
//   refuse    — empty with no dependency to explain it, or still empty after a re-capture. Refuse honestly.
function emptyDiffAction({ diff_bytes, touched_surfaces_count, has_deps, recaptured }) {
  if (diff_bytes > 0) return 'proceed'
  if (diff_bytes == null) return (touched_surfaces_count > 0) ? 'proceed' : 'measure'
  if (has_deps && !recaptured) return 'recapture'
  return 'refuse'
}

// Stop on cost before stopping on round count, so cost is the reported reason when cost is the cause. A round that
// overran its own ceiling, or cumulative spend at or past the task ceiling, both read as "budget". Otherwise: round
// count, then a finding repeating a previously-attempted one, then no fresh finding at all (including an empty set).
function shouldEscalate(ctx, findings) {
  if (ctx.tokens >= ctx.task_tokens || ctx.last_round_tokens > ctx.round_tokens) return 'budget'
  // A stuck lens reports as repeat_finding — the existing enum value, because the contract's reason list is fixed
  // and this IS a repeat, just one the dedupe_key could not see.
  if (stuckLens(ctx.lens_streaks, ctx.k_rounds)) return 'repeat_finding'
  if (ctx.round >= ctx.k_rounds) return graceRound(ctx, findings) ? null : 'max_rounds'
  const keys = (findings ?? []).map(f => f.dedupe_key)
  const seenKeys = ctx.seen ?? new Set()
  const overlap = keys.filter(k => seenKeys.has(k))
  if (ctx.round > 1 && keys.length && overlap.length === keys.length && overlap.length === seenKeys.size) return 'repeat_finding'
  if (!keys.length || keys.every(k => seenKeys.has(k))) return 'no_fresh_findings'
  return null
}

// ---- Owned-surfaces boundary (wi-unactionable-findings) ----
// Task.owned_surfaces was told to the decomposer and the implementer and verified by nobody; a ChangeSet's
// touched_surfaces were reported and compared to nothing. These functions close that gap in pure code, called on
// the settled ChangeSet before any lens, test runner or fixer runs, and again on each round's merged ChangeSet.

// Canonical form of a Surface ref: drop a '#...' fragment (a schema pointer), a leading './', and a trailing '/'.
// {kind:'schema', ref:'contracts.schema.json#/$defs/Finding'} -> 'contracts.schema.json'.
function surfaceRef(surface) {
  let ref = String(surface?.ref ?? '')
  const hashIdx = ref.indexOf('#')
  if (hashIdx !== -1) ref = ref.slice(0, hashIdx)
  if (ref.startsWith('./')) ref = ref.slice(2)
  if (ref.length > 1 && ref.endsWith('/')) ref = ref.slice(0, -1)
  return ref
}

// True when touchedRef sits inside one of ownedRefs or exemptPrefixes. An owned/exempt ref ending in '/' is
// directory-shaped: it covers itself and everything under it. One that does NOT end in '/' covers only an exact
// match — 'substrate/test' never covers 'substrate/testing/x.js', a sibling-prefix near-miss a naive startsWith
// would wrongly allow.
function withinOwned(touchedRef, ownedRefs, exemptPrefixes) {
  const t = surfaceRef({ ref: touchedRef })
  const covers = (rawRef) => {
    let owned = String(rawRef ?? '')
    const hashIdx = owned.indexOf('#')
    if (hashIdx !== -1) owned = owned.slice(0, hashIdx)
    if (owned.startsWith('./')) owned = owned.slice(2)
    if (t === owned) return true
    if (owned.endsWith('/')) {
      const dir = owned.slice(0, -1)
      if (t === dir || t.startsWith(owned)) return true
    }
    return false
  }
  return (ownedRefs ?? []).some(covers) || (exemptPrefixes ?? []).some(covers)
}

// Sorts every touched surface into: within this task's own envelope (ignored), within a sibling task's envelope
// (a stray — the boundary violation), or claimed by nobody in the graph (unowned — a warning, never a defect).
// touched_surfaces stays a permission ENVELOPE: only work OUTSIDE it is ever a problem, and this function is the
// only place that decides "outside".
function boundaryCheck({ touched_surfaces, owned_surfaces, siblings, exempt_prefixes }) {
  const ownRefs = (owned_surfaces ?? []).map(s => s.ref)
  const exempts = exempt_prefixes ?? []
  const strays = []
  const unowned = []
  for (const surf of touched_surfaces ?? []) {
    const ref = surfaceRef(surf)
    if (withinOwned(ref, ownRefs, exempts)) continue
    let owner = null
    for (const sib of siblings ?? []) {
      const sibRefs = (sib.owned_surfaces ?? []).map(s => s.ref)
      if (withinOwned(ref, sibRefs, exempts)) { owner = sib.id; break }
    }
    if (owner) strays.push({ ref, owner })
    else unowned.push(ref)
  }
  const verdict = strays.length ? 'violation' : (unowned.length ? 'unowned' : 'clean')
  return { verdict, strays, unowned }
}

// The acceptance criteria this task owns, which sibling task (same spec, same TaskGraph) owns each of the rest,
// and which criteria in acceptance_ids no task IN THE WHOLE GRAPH claims at all. A task in a DIFFERENT spec is
// never a sibling — it never appears in sibling_owner — but it still CLAIMS its own criteria, so those criteria
// are not unassigned either; unassigned is reserved for a criterion no task anywhere owns. Degrades to an empty
// unassigned list — never throws — when acceptance_ids is not supplied.
function criteriaScope({ task, tasks, acceptance_ids }) {
  const owned = [...(task?.criteria_ids ?? [])]
  const otherTasks = (tasks ?? []).filter(t => t && t.id !== task?.id)
  const siblingTasks = otherTasks.filter(t => t.spec_id === task?.spec_id)
  const sibling_owner = {}
  for (const sib of siblingTasks) {
    for (const c of sib.criteria_ids ?? []) {
      if (!(c in sibling_owner)) sibling_owner[c] = sib.id
    }
  }
  const claimed = new Set(owned)
  for (const t of otherTasks) {
    for (const c of t.criteria_ids ?? []) claimed.add(c)
  }
  const unassigned = (acceptance_ids ?? []).filter(id => !claimed.has(id))
  return { owned, sibling_owner, unassigned }
}

// Acceptance-criterion ids cited as WHOLE tokens across a finding's claim, evidence and location — never a
// substring hit inside a longer id ('AC-12' inside 'AC-121') or a longer word ('AC-1' inside 'xAC-1').
function citedCriteria(finding, acceptanceIds) {
  const text = [finding?.claim, finding?.evidence, finding?.location].filter(Boolean).join('\n')
  const found = []
  for (const id of acceptanceIds ?? []) {
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`)
    if (re.test(text)) found.push(id)
  }
  return found
}

// True only when a finding cites criteria and EVERY criterion it cites belongs to a sibling — never this task's
// own, never an uncited finding, never a mix, and never a criterion nobody in the spec owns (unassigned stays
// today's behaviour: nobody to attribute it to, so it is not dropped as foreign).
function isForeignCriterionFinding(finding, scope) {
  const owned = new Set(scope?.owned ?? [])
  const siblingIds = Object.keys(scope?.sibling_owner ?? {})
  const unassigned = new Set(scope?.unassigned ?? [])
  const universe = [...owned, ...siblingIds, ...unassigned]
  const cited = citedCriteria(finding, universe)
  if (!cited.length) return false
  if (cited.some(c => owned.has(c))) return false
  return cited.length > 0 && cited.every(c => siblingIds.includes(c))
}

// Removes, from each verdict's findings, every finding whose only cited acceptance criteria belong to a sibling
// task — so a task owning one criterion of seventeen is never failed for the other sixteen. Returns the pruned
// verdicts plus a dropped list (dedupe_key, the cited criterion, and the sibling task id that owns it) so the
// caller can log it and keep it out of `seen` and the deduped findings list.
function stripForeignFindings(verdicts, scope) {
  const siblingOwner = scope?.sibling_owner ?? {}
  const siblingIds = Object.keys(siblingOwner)
  const dropped = []
  const next = (verdicts ?? []).map(v => {
    const kept = []
    for (const f of v.findings ?? []) {
      if (isForeignCriterionFinding(f, scope)) {
        const cited = citedCriteria(f, siblingIds)
        const criterion = cited[0]
        dropped.push({ dedupe_key: f.dedupe_key, criterion, sibling: siblingOwner[criterion] })
      } else {
        kept.push(f)
      }
    }
    return { ...v, findings: kept }
  })
  return { verdicts: next, dropped }
}

// Which repair path a finding belongs to. target, when the lens set it, decides outright. Only when it is absent
// does the existing location rule decide: under the test artifact directory or the TestSet's tests_ref is "test",
// everything else is "code". Replaces isTestFinding, which decided by location alone and sent a finding about a
// test assertion (whose location points at the code the assertion covers) to the code Fixer, forbidden to edit tests.
function routeFinding(finding, { tests_ref, artifact_dir } = {}) {
  if (finding?.target === 'test') return 'test'
  if (finding?.target === 'implementation') return 'code'
  const loc = String(finding?.location ?? '')
  const testsDir = artifact_dir ? `${artifact_dir}/tests/` : null
  if ((testsDir && loc.includes(testsDir)) || (tests_ref && loc.includes(tests_ref))) return 'test'
  return 'code'
}

// A code Fixer's notes decide the outcome of its fix: 'TEST-ONLY:' means the defect is really in the test, not
// the code the Fixer owns — routed once to the Test Author repair path, distinct from 'DISPUTE:', which the
// dispute judge rules on. Anything else is a normal applied fix.
function fixOutcome(notes) {
  const n = String(notes ?? '')
  if (n.startsWith('TEST-ONLY:')) return 'test_only'
  if (n.startsWith('DISPUTE:')) return 'dispute'
  return 'applied'
}

// ---- k1v fix: a test-path dispute reaching no judge ----
// The pre-fix hole filtered disputes down to the code repair path alone, so a repair on the TEST path that
// disputed matched neither that filter nor the applied-test-repair list (which excludes a repair whose notes
// begin "DISPUTE:") and simply vanished. These five functions are deliberately blind to which repair path
// produced a dispute, and make "nobody resolved it" a resolution in its own right instead of a silent absence.

// Every disputing repair, first occurrence per dedupe_key, in insertion order — read ONLY via fixOutcome(notes),
// never via a repair's path/kind, so a code Fixer's dispute and a Test Author's dispute are selected identically.
function disputesToJudge(repairs) {
  const seen = new Set()
  const out = []
  for (const r of repairs ?? []) {
    if (!r || r.dedupe_key == null) continue
    if (fixOutcome(r.notes) !== 'dispute') continue
    if (seen.has(r.dedupe_key)) continue
    seen.add(r.dedupe_key)
    out.push(r)
  }
  return out
}

// The single source of a round's resolution map and of what survives into the next round. Every dedupe_key that
// appears ANYWHERE in the inputs gets an entry — 'nobody resolved it' is the explicit value 'unresolved', never an
// absent key a caller could mistake for settled. `carried` is what a round-outcome guard must treat as still open:
// everything except a finding this round actually fixed or a judge actually overruled.
// The TestSet the next round runs, after a Test Author repair returned `repaired` (k13d). A repair of ONE file
// inside the current TestSet directory must not narrow the run to that file: on k13 it did, and the runner then
// ran 3 of 14 criteria's tests for every later round while criteria_coverage still claimed all 14. A repaired
// ref inside (or equal to) the current one keeps the current one; a ref elsewhere replaces it, as before.
function widenTestsRef(current, repaired) {
  if (!repaired) return current
  if (!current) return repaired
  const dir = String(current).replace(/\/+$/, '')
  return repaired === current || String(repaired).startsWith(dir + '/') ? current : repaired
}

function resolveRound({ findings, carried_in, deferred, repairs, rulings, tests_ref }) {
  const resolution = {}
  const rulingByKey = new Map((rulings ?? []).filter(r => r && r.dedupe_key != null).map(r => [r.dedupe_key, r.ruling]))
  const deferredKeys = new Set((deferred ?? []).map(f => f.dedupe_key))
  deferredKeys.forEach(k => { resolution[k] = 'deferred' })

  for (const r of repairs ?? []) {
    if (!r || r.dedupe_key == null || deferredKeys.has(r.dedupe_key)) continue
    const outcome = fixOutcome(r.notes)
    if (outcome === 'applied') { resolution[r.dedupe_key] = 'fixed'; continue }
    if (outcome === 'dispute') {
      const ruling = rulingByKey.get(r.dedupe_key)
      if (ruling === 'overrule') resolution[r.dedupe_key] = 'overruled'
      else if (ruling === 'uphold') resolution[r.dedupe_key] = 'upheld'
      else if (!(r.dedupe_key in resolution)) resolution[r.dedupe_key] = 'unresolved'
      continue
    }
    if (!(r.dedupe_key in resolution)) resolution[r.dedupe_key] = 'unresolved'
  }

  const allKeys = new Set([
    ...(findings ?? []).map(f => f.dedupe_key),
    ...(carried_in ?? []).map(f => f.dedupe_key),
    ...(deferred ?? []).map(f => f.dedupe_key),
    ...(repairs ?? []).map(r => r?.dedupe_key),
  ])
  allKeys.forEach(k => { if (k != null && !(k in resolution)) resolution[k] = 'unresolved' })

  const byKey = new Map()
  for (const f of [...(carried_in ?? []), ...(findings ?? []), ...(deferred ?? [])]) {
    if (f && f.dedupe_key != null && !byKey.has(f.dedupe_key)) byKey.set(f.dedupe_key, f)
  }
  const carried = [...byKey.values()].filter(f => resolution[f.dedupe_key] !== 'fixed' && resolution[f.dedupe_key] !== 'overruled')

  // A test repair's `tests_ref` is a string the Test Author agent chose to return, not something this loop can
  // trust as-is: testRepairTarget later hands it straight to the Test Author as a WRITE target whenever a
  // finding's location isn't a file, and also matches a finding.location's prefix against it to decide whether
  // that location is "already inside the artifact TestSet". An absolute path or a '..' segment here would smuggle
  // a traversal target past both uses — the same class of value scopeOf already rejects for finding.location.
  // Reject it here too and keep the previous tests_ref rather than adopt it.
  const isSafeTestsRef = (s) => {
    const candidate = String(s ?? '').trim()
    if (!candidate || /\s/.test(candidate)) return false
    if (candidate.startsWith('/') || candidate.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(candidate)) return false
    if (candidate.split(/[\\/]/).some(seg => seg === '..' || seg === '.')) return false
    return true
  }
  let nextTestsRef = tests_ref
  for (const r of repairs ?? []) {
    if (r?.target_source === 'tests_ref' && fixOutcome(r.notes) !== 'dispute' && r.tests_ref && isSafeTestsRef(r.tests_ref)) nextTestsRef = widenTestsRef(nextTestsRef, r.tests_ref)
  }

  const needs_rediff = (repairs ?? []).some(r => {
    if (!r || fixOutcome(r.notes) === 'dispute') return false
    if (r.path === 'code') return true
    return r.path === 'test' && r.target_source === 'finding_location'
  })

  return { resolution, carried, tests_ref: nextTestsRef, needs_rediff }
}

// A green panel (nothing failed this round) is only actually green when nothing survives from resolveRound's
// carried list — an earlier round's test dispute that nobody ruled on, or an upheld finding, does not clear itself
// just because a cheap lens stopped re-raising it. 'pass' is the ONLY route the loop below takes to a passing task.
function roundOutcome({ panel_result, carried }) {
  if (panel_result !== 'pass') return 'continue'
  return (carried && carried.length) ? 'escalate' : 'pass'
}

// Where a test repair belongs: the file the finding actually cites (inside the task worktree, when one is given),
// UNLESS that file is already the artifact TestSet itself, in which case the repair targets tests_ref directly and
// no cumulative rediff is owed for it. Falls back to the whole tests_ref when the location is not a file at all.
function testRepairTarget({ finding, tests_ref, artifact_dir, worktree }) {
  const file = scopeOf(finding?.location)
  if (!file) return { ref: tests_ref, source: 'tests_ref' }
  const testsDirPrefix = artifact_dir ? `${artifact_dir}/tests/` : null
  const underArtifactTests = (testsDirPrefix && file.startsWith(testsDirPrefix)) || (tests_ref && file.startsWith(tests_ref))
  if (underArtifactTests) return { ref: file, source: 'tests_ref' }
  // A finding.location is untrusted input from a verifier lens. An absolute path or a '..' segment does not
  // name a file inside this task's worktree — it names a repair target outside it (e.g. "/etc/passwd:10" or
  // "../../../../etc/passwd:10" surviving scopeOf as a bare path). Treat it as not-a-file rather than let it be
  // concatenated into ${worktree}/${file} (or returned bare when worktree is falsy) and handed to the Test
  // Author's repair prompt as a write target.
  if (file.startsWith('/') || file.split('/').includes('..')) return { ref: tests_ref, source: 'tests_ref' }
  return { ref: worktree ? `${worktree}/${file}` : file, source: 'finding_location' }
}

// A basename integration reported as tests_skipped (already exists in the repo test dir, never overwritten) that a
// repair path actually edited in the artifact TestSet is not a stale duplicate — it is a lost fix. Matched by
// basename only against repairs whose target was the artifact TestSet (tests_ref); a repair that edited a file on
// the task branch (finding_location) is excluded because the branch merge already carries it.
function unlandedRepairs({ tests_skipped, repaired_tests }) {
  const basename = (p) => String(p ?? '').split('/').pop()
  const targeted = new Set((repaired_tests ?? []).filter(r => r?.source === 'tests_ref').map(r => basename(r.ref)))
  return (tests_skipped ?? []).filter(name => targeted.has(basename(name)))
}

// ---- Sibling value repair (wi-b5): the response to a boundary violation or a needs_from_sibling ask, when the
// human-costing Escalation isn't the only option. Pure decision: no runtime handle crosses in, nothing here
// waits on anything. First-seen order throughout — the same task strayed into the same owner twelve times still
// names that owner once.

// Every distinct sibling task id an owned-surfaces stray or a needs_from_sibling ask points at, first-seen,
// straying owners first (in strays' order) then any additional owner a needs_from_sibling surface resolves to.
// A needs_from_sibling surface owned by no sibling (withinOwned over every sibling's owned_surfaces) is reported
// as unowned rather than silently dropped — boundaryRepair escalates outright when unowned is non-empty.
function repairOwners(strays, needs, siblings) {
  const owners = []
  const unowned = []
  for (const s of strays ?? []) if (s?.owner && !owners.includes(s.owner)) owners.push(s.owner)
  for (const n of needs ?? []) {
    let owner = null
    for (const sib of siblings ?? []) {
      const sibRefs = (sib?.owned_surfaces ?? []).map(x => x.ref)
      if (withinOwned(n?.surface, sibRefs, [])) { owner = sib.id; break }
    }
    if (!owner) unowned.push(n)
    else if (!owners.includes(owner)) owners.push(owner)
  }
  return { owners, unowned }
}

// True when awaiting `owners` from `task_id` would deadlock: an owner has itself recorded straying into
// task_id (violations carries { straying_task_id, strays: [{ref, owner}] }), or waiting_on already has that
// owner awaiting task_id (through a depends_on chain or an active repair wait). Checked before any 'wait' is
// ever returned, so the script never awaits a sibling that is awaiting it back.
function isMutualWait(task_id, owners, violations, waiting_on) {
  for (const owner of owners ?? []) {
    const stray = (violations ?? []).some(v => v?.straying_task_id === owner && (v.strays ?? []).some(s => s?.owner === task_id))
    if (stray) return true
    if ((waiting_on?.[owner] ?? []).includes(task_id)) return true
  }
  return false
}

// The one repair decision consulted at both boundary call sites and at the needs_from_sibling routing point
// (AC-2 through AC-7 of spec-wi-b5-sibling-value-repair). Discards the stray branch by never returning it (the
// caller re-runs the strayer's implementer on a FRESH branch, never patches the old one), waits for the owning
// siblings' existing taskDone promises, and re-runs the implementer once on a branch based on the owners'
// finished branches — never more than once (`repair_used`) and never for a mutual stray (both escalate).
//   proceed  — nothing to repair: no strays, no needs_from_sibling.
//   escalate — reason 'need_unowned' (a needs_from_sibling surface no sibling owns), 'mutual' (owner is itself
//              awaiting this task), 'repair_used' (this task already spent its one repair), or 'owner_failed'
//              (an owner is missing from owner_results or did not pass). owners names who was involved; never
//              'wait' or 'rerun' once repair_used is true.
//   wait     — owner_results absent: the caller must pause on the named owners' taskDone promises and call again.
//   rerun    — owner_results present and every owner passed: base_branch is the first owner's branch (first-seen
//              order), merge_branches every remaining owner's branch.
function boundaryRepair({ task_id, strays, needs_from_sibling, siblings, repair_used, violations, waiting_on, owner_results }) {
  const strayList = strays ?? []
  const needsList = needs_from_sibling ?? []
  if (!strayList.length && !needsList.length) return { action: 'proceed' }

  const { owners, unowned } = repairOwners(strayList, needsList, siblings)
  if (unowned.length) return { action: 'escalate', reason: 'need_unowned', owners }
  if (isMutualWait(task_id, owners, violations, waiting_on)) return { action: 'escalate', reason: 'mutual', owners }
  if (repair_used) return { action: 'escalate', reason: 'repair_used', owners }
  if (!owner_results) return { action: 'wait', owners }

  const failed = owners.filter(o => !owner_results[o] || owner_results[o].passed !== true)
  if (failed.length) return { action: 'escalate', reason: 'owner_failed', owners }

  const branches = owners.map(o => owner_results[o].branch)
  return { action: 'rerun', owners, base_branch: branches[0], merge_branches: branches.slice(1) }
}

// requested_paths is the passing TestSets' tests_ref list (Integrate calls this with exactly that — AC-21):
// with none requested, no TestSet path was ever asked to land, so nothing can be unaccounted for regardless of
// what tests_found lists (a pre-existing repo test file is not a TestSet file that went missing). Otherwise the
// answer is simply tests_found minus whatever was landed or skipped.
function unaccountedTestFiles({ requested_paths, tests_found, tests_landed, tests_skipped }) {
  if (!(requested_paths ?? []).length) return []
  const accounted = new Set([...(tests_landed ?? []), ...(tests_skipped ?? [])])
  return (tests_found ?? []).filter(f => !accounted.has(f))
}

// ---- Test validity before blame (wi-b6): a failing test counts against the implementation only once it is
// shown to be valid. testValidity is the ONE place that decision is made — an agent (the validity: detector)
// reports facts only, never a verdict (out_of_scope forbids letting it vote), so every fact->class mapping lives
// here, pure, where a test can drive it with plain objects instead of running the whole loop.
//
// A missing or non-boolean fact never counts as true (AC-5): `=== true` is the only way in, so 'yes', 1, or an
// absent key all read as false, and a test with no established facts at all reads as 'unclear' rather than
// defaulting toward blaming either side.
//   test_defect  — the test itself is broken: it locates the code under test by first textual occurrence rather
//                  than by call structure, or it requires an exact identifier/string the Spec never quoted (AC-2,
//                  true even when the test's own message talks about the right criterion); OR it already failed on
//                  the task's BASE commit for the same reason while not describing the cited criterion's behaviour
//                  (AC-3) — it asserts something this task was never asked to change.
//   code_defect  — the test names the cited criterion's behaviour and none of the test-defect signals apply (AC-4).
//   unclear      — anything else: no signal fired, or the base-failure and criterion-naming signals both fired at
//                  once (AC-5b), which is genuinely ambiguous rather than a defect on either side.
function testValidity(facts) {
  const f = facts ?? {}
  const is = (v) => v === true
  const locatesByFirstOccurrence = is(f.locates_by_first_occurrence)
  const requiresUnquotedLiteral = is(f.requires_unquoted_literal)
  const failsOnBaseSameReason = is(f.fails_on_base_same_reason)
  const namesCriterionBehaviour = is(f.names_criterion_behaviour)
  if (locatesByFirstOccurrence || requiresUnquotedLiteral) return 'test_defect'
  if (failsOnBaseSameReason && !namesCriterionBehaviour) return 'test_defect'
  if (namesCriterionBehaviour && !failsOnBaseSameReason) return 'code_defect'
  return 'unclear'
}

// True when a finding's claim, evidence or location names one of THIS round's currently failing tests as a whole
// word — the same whole-word rule citedCriteria uses, so a test named e.g. "AC-2" is never matched as a substring
// of "AC-2b". Only consulted for a finding whose fixer reported behaviour_changed:false (fixRefused below); a
// finding that never cites a failing test is never in scope for that refusal.
function citesFailingTest(finding, failingTestNames) {
  return citedCriteria(finding, failingTestNames ?? []).length > 0
}

// The fix-refusal decision (AC-13): a code fixer may not bend the implementation to fit a test's own text. Refused
// only when the fixer itself reported behaviour_changed:false (true, or absent because an older fixer never set
// it, both pass through unrefused) AND the finding it "fixed" cites a test that is currently failing. Consulted
// ONLY for a fix whose outcome is already 'applied' (fixOutcome) — a DISPUTE: or TEST-ONLY: fix is a different,
// pre-existing outcome and is never re-decided here.
function fixRefused({ behaviour_changed, cites_test_failure }) {
  return behaviour_changed === false && cites_test_failure === true
}
// ---- END fix-loop decisions ----

// =====================================================================
// ---- Spec Gate check: a high-risk spec may not be built on the caller's word ----
// build-spec marks a high-risk spec gate:"pending" and opens a spec_gate record. Until now NOTHING closed that
// loop: the human decided in gates/, nothing wrote the decision back into the Spec artifact, and this workflow
// never looked. A pending spec built exactly as readily as an approved one — a check that passes by default, which
// is the one shape the operating conventions forbid. The gate FILE is the signature, never args (the Phase 3
// convention, and the same guard /build-reentry puts on the sev1 page).
const GateCheck = { type: 'object', additionalProperties: false, required: ['found', 'status', 'gate', 'option'],
  properties: { found: { type: 'boolean' }, status: { type: 'string' }, gate: { type: 'string' },
    option: { type: 'string' }, decided_by: { type: 'string' }, decided_at: { type: 'string' }, note: { type: 'string' } } }
const pendingSpecs = A.specs.filter(s => s.spec?.gate === 'pending')
if (pendingSpecs.length) {
  if (!A.gate?.gate_id) {
    return { refused: true, reason: `${pendingSpecs.length} spec(s) are gate:"pending" (${pendingSpecs.map(s => s.spec.id).join(', ')}) and no gate_id was passed. A high-risk spec is built only after a decided spec_gate, and the decision is read from gates/, not from args.`,
      provenance: stamp('build-implement', 'n/a', 'hotl') }
  }
  const g = await agent(`Run from the repository root: node substrate/gates.js show ${A.gate.gate_id}. Report found, status, gate,
       decision.option ("" if none), decision.decided_by, decision.decided_at and decision.note ("" if absent).
       Copy the values, never interpret them. If the command fails, found=false and the error text in note.`,
    { label: 'gate:spec_gate', model: MODEL.cheap, ...AT('mechanical'), schema: GateCheck })
  const ok = g && g.found && g.status === 'decided' && g.gate === 'spec_gate' && g.option === 'approve'
  if (!ok) {
    return { refused: true, reason: `spec_gate ${A.gate.gate_id} does not authorise this build: ${JSON.stringify(g ?? { found: false })}. Required: found, status "decided", gate "spec_gate", option "approve".`,
      provenance: stamp('build-implement', 'n/a', 'hotl') }
  }
  log(`spec_gate ${A.gate.gate_id} verified: ${g.option} by ${g.decided_by ?? 'unknown'} — ${pendingSpecs.length} gated spec(s) cleared`)
}

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

// Per-task token ceiling (point 3): a WorkItem's budget, when the caller passes one, splits evenly across its
// tasks in THIS run. Absent work_item_budgets, taskCeiling falls back to TASK_TOKENS untouched — additive only.
const tasksPerWorkItem = new Map()
for (const { spec } of tasks) tasksPerWorkItem.set(spec.work_item_id, (tasksPerWorkItem.get(spec.work_item_id) ?? 0) + 1)

const panelResults = []
const escalations = []
// Run-level record of every recorded boundary violation: { straying_task_id, strays: [{ref, owner}] }. Read by a
// later task's empty-diff refusal (AC-7) to name the sibling recorded straying into ITS owned surfaces, instead of
// the generic "check whether that implementer wrote outside its owned surfaces".
const boundaryViolations = []
// One entry per boundary-repair attempt this run made (AC-13), whatever it concluded. [] when no task strayed.
const boundaryRepairs = []
const taskDone = {}, resolveTask = {}
for (const { task } of tasks) taskDone[task.id] = new Promise(r => { resolveTask[task.id] = r })

// Run-level registry (AC-12): task_id -> sibling ids it is CURRENTLY awaiting through an active repair wait.
// Populated right before an `await taskDone[...]` below and cleared right after, so a concurrent sibling's
// boundaryRepair call sees an accurate, momentary picture rather than a stale one.
const waitingRegistry = {}
// Every id `taskId`'s task depends_on, transitively, excluding itself — the depends_on half of the waiting_on
// argument boundaryRepair reads for its mutual-wait guard (AC-12).
function transitiveDepIds(taskId, seen = new Set()) {
  const entry = tasks.find(t => t.task.id === taskId)
  for (const d of entry?.task.depends_on ?? []) {
    if (!seen.has(d)) { seen.add(d); transitiveDepIds(d, seen) }
  }
  return seen
}
function waitingOnMap(ids) {
  const out = {}
  for (const id of ids ?? []) out[id] = [...new Set([...(waitingRegistry[id] ?? []), ...transitiveDepIds(id)])]
  return out
}

const finished = (await pipeline(tasks, async (item) => {
  const out = await runTask(item)
  resolveTask[item.task.id](out)
  return out
})).filter(Boolean)

async function runTask({ spec, task, spec_ref }) {
  // wt and branch are reassigned once, after a boundary repair rerun succeeds (AC-9, AC-10): the strayer's
  // ORIGINAL task/<id> branch is discarded and every later reference in this function — verify loop, fixer,
  // panel, the pass/fail return — reads the fresh repair branch instead, without a second code path.
  let wt = `${ART}/worktrees/${task.id}`
  // The else branch used to read `${specText}` — its own binding, inside its own initializer. That is a temporal
  // dead zone ReferenceError, so EVERY task crashed on any call without spec_ref. It never fired because every run
  // to date happened to pass one. With no ref there is no file to point at, so the spec is inlined whole.
  const specText = spec_ref
    ? `Spec: the FULL spec (acceptance criteria, touched surfaces, exclusions) is at ${spec_ref}; read it before acting. Summary: ${JSON.stringify({ id: spec.id, goal: spec.goal, touched_surfaces: spec.touched_surfaces, exclusions: spec.out_of_scope })}`
    : `Spec: ${JSON.stringify({ id: spec.id, goal: spec.goal, acceptance: spec.acceptance, touched_surfaces: spec.touched_surfaces, exclusions: spec.out_of_scope })}`
  // Sibling tasks: same spec's TaskGraph, everyone else. Used by the boundary check (a stray into a sibling's
  // owned surfaces is a violation) and by the lens prompt's criteria scope (AC-12).
  const siblingTasks = tasks.filter(t => t.spec.id === spec.id && t.task.id !== task.id).map(t => t.task)
  const depIds = (task.depends_on ?? []).filter(d => taskDone[d])
  const deps = await Promise.all(depIds.map(d => taskDone[d]))
  if (deps.some(d => !d || !d.passed)) {
    log(`${task.id}: skipped, a dependency did not pass`)
    return { spec, task, passed: false, skipped: true }
  }
  const vo = A.verify_only?.[task.id]
  let branch = vo ? vo.branch : `task/${task.id}`
  // A dependency's RESULT branch, not task/<id>: a dependency that was boundary-repaired passed on its fresh
  // repair branch, and task/<id> is the abandoned stray (k9d). A pass always carries `branch`; the fallback is
  // only for a result shape that predates it.
  const depBranch = (d) => d.branch ?? `task/${d.task.id}`
  const base = vo ? vo.base : (deps.length ? depBranch(deps[deps.length - 1]) : BASE)
  const extraMerges = deps.slice(0, -1).map(depBranch)
  // Sibling ids and owned_surfaces, told to the implementer (AC-15) so it can name a sibling's surface in
  // needs_from_sibling instead of guessing, and so it never invents a reason to write there instead.
  const siblingSurfaces = siblingTasks.map(t => ({ id: t.id, owned_surfaces: t.owned_surfaces }))

  // ---- Implementer ∥ Test Author: both consume only Spec + Task ----
  const [changeSet0, testSet] = await parallel([
    () => vo ? agent(`VERIFY ONLY: the change already exists on branch ${branch}. Check it out: git worktree add ${wt} ${branch} (skip if ${wt} exists).
                 App at ${wt}/${APP}/ (npm ci there if node_modules is missing). Do NOT modify any code. Write the cumulative diff ${base}...${branch}
                 (git diff ${base}...HEAD inside the worktree) to ${ART}/diffs/${task.id}.r0.patch and return that path as diff_ref. ALSO report diff_bytes:
                 the exact byte size of that file (wc -c). Report 0 honestly if it is empty — never omit it, never round it,
                 and never substitute a different diff to make it non-empty. base_commit = the sha of ${base}; worktree = "${wt}"; revision 0; touched_surfaces from the diff.
                 Task: ${JSON.stringify(task)}.`,
      { label: `checkout:${task.id}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    : agent(`Create a worktree of THIS repository on a new branch: git worktree add -b task/${task.id} ${wt} ${base} (skip if it exists).
                 ${extraMerges.length ? `First merge ${extraMerges.join(', ')} into the branch. ` : ''}The app is at ${wt}/${APP}/ (run npm ci there if node_modules is missing).
                 Implement this task there, staying inside owned surfaces (paths are repository-relative). Commit your work on the task branch.
                 Then write the cumulative diff vs ${base} (git diff ${base}...HEAD, run inside the worktree) to ${ART}/diffs/${task.id}.r0.patch
                 and return that path as diff_ref; ALSO report diff_bytes: the exact byte size of that file (wc -c), reported
                 honestly as 0 if your commit added nothing to ${base}. base_commit = the sha of ${base}; worktree = "${wt}".
                 Sibling tasks in this same spec, and the surfaces each one owns (never write inside any of them):
                 ${JSON.stringify(siblingSurfaces)}. If this task needs a value one of those surfaces creates and you cannot derive
                 it yourself, do not invent it and do not write there — return needs_from_sibling: [{ surface, what }] naming the
                 surface and what you need, and leave the rest of the diff as far as you got without it (an empty diff is fine here).
                 Task: ${JSON.stringify(task)}. ${specText}.`,
      { label: `impl:${task.id}`, model: MODEL.mid, ...AT('implementer'), schema: ChangeSet }),
    () => agent(`Write tests FROM THE SPEC ONLY — do not read any implementation. Cover criteria ${JSON.stringify(task.criteria_ids)}.
                 Write them under ${ART}/tests/${task.id}/ and return the path as tests_ref. ${A.test_hint ?? ''}
                 A source-text WIRING test — one that checks which calls happen, in which order, inside a named function — must use
                 substrate/test/b5-wiring-helpers.js (functionNamed, enclosingFunction, callSites, reachersOf, firstCallOf) to find those
                 call sites; it must NEVER locate anything by the first textual occurrence of a name in the file (indexOf and similar),
                 which finds a declaration or an unrelated mention just as easily as the call the test means to check, and a test built on
                 it is a test defect, not a correctness finding. Require an exact literal (an identifier or string match) only when the
                 Spec itself quotes that literal — never invent one merely because it makes the assertion easier to write.
                 Task: ${JSON.stringify(task)}. ${specText}.`,
      { label: `tests:${task.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestSet }),
  ])
  if (!changeSet0 || !testSet) return null

  // ctx is created here — before the empty-diff gate, before any lens, test runner or fixer — so the
  // needs_from_sibling routing below (AC-16) and the boundary-repair machinery both have ctx.history and
  // ctx.repair_used to read and write from the earliest possible point. ctx.changeSet is provisional here
  // (changeSet0, pre empty-diff-gate, pre canary) and is reassigned as the settled ChangeSet emerges below.
  const taskTokenCeiling = taskCeiling({ work_item_tokens: A.work_item_budgets?.[spec.work_item_id]?.tokens,
    tasks_for_work_item: tasksPerWorkItem.get(spec.work_item_id) ?? 1, default_task_tokens: TASK_TOKENS })
  const roundTokenCeiling = roundBudget({ task_tokens: taskTokenCeiling, k_rounds: K_ROUNDS, round_tokens: A.budget?.round_tokens })
  const ctx = { spec, task, changeSet: changeSet0, testSet, seen: new Set(), round: 0, k_rounds: K_ROUNDS,
                tokens: 0, last_round_tokens: 0, task_tokens: taskTokenCeiling, round_tokens: roundTokenCeiling,
                lens_streaks: {}, grace_used: false,
                history: [], overruled: [], upheld: [], mode: 'retry', toRun: LENSES, verified: new Set(),
                // carried: findings resolveRound says are still open (unresolved or upheld) across rounds,
                // independent of whether a lens re-raises them — the k1v guard reads this, not the panel verdict alone.
                carried: [],
                // repairedTests: { ref, source } for every non-disputing test repair this task's Test Author made,
                // read at Integrate to name a skipped basename a repair actually touched (unlandedRepairs).
                repairedTests: [],
                // repair_used: this task's one allowed boundary repair (sibling-value-repair), spent at most once.
                repair_used: false,
                // testValidity: one entry per failing-test classification made across this task's rounds (wi-b6,
                // AC-11), from the detector's facts or a refused fixer's behaviour_changed:false. Emitted in the
                // run output as-is; [] when nothing was ever classified.
                testValidity: [],
                // testDefectRecheckUsed: this task's one forced extra confirm round after a test_defect repair
                // (AC-9) — the task must not pass in the very round a test_defect was found and routed to the Test
                // Author, before the Test Runner has re-run against the repair. Bounded at one, exactly like
                // grace_used, so a disputed or ineffective repair cannot hold the loop open forever.
                testDefectRecheckUsed: false }
  const fileOf = (loc) => String(loc).split(':')[0].trim()

  // ---- needs_from_sibling routing (AC-16): consulted BEFORE the empty-diff gate and before any run, lens,
  // slice or fix label, because an implementer that asks instead of inventing may legitimately return an
  // empty diff — the empty-diff gate must never see that as a refusal to explain. routeBoundary, defined
  // further down as a `function` declaration, is hoisted and already callable here.
  const needs0 = ctx.changeSet.needs_from_sibling ?? []
  if (needs0.length) {
    const outcome = await routeBoundary([], needs0)
    if (!outcome.proceed) return { ...ctx, passed: false }
    if (outcome.changeSet) ctx.changeSet = outcome.changeSet
  }

  // ---- Empty-diff gate: decided from the ChangeSet, before any lens, test runner or fixer is called ----
  // A diff that measured empty is not a change to review. Letting the panel run on one is how t5i deadlocked: the
  // lenses read a tree the fixer could not see. This costs at most one cheap re-capture, and usually nothing.
  let cs = ctx.changeSet
  let recaptured = false
  for (;;) {
    const action = emptyDiffAction({
      diff_bytes: cs.diff_bytes, touched_surfaces_count: (cs.touched_surfaces ?? []).length,
      has_deps: deps.length > 0, recaptured,
    })
    if (action === 'proceed') break
    if (action === 'measure' || action === 'recapture') {
      const against = action === 'recapture' ? BASE : base
      const re = await agent(`In worktree ${wt} on branch ${branch}, rewrite the cumulative diff against ${against}
             (git diff ${against}...HEAD, run inside the worktree) to ${ART}/diffs/${task.id}.r0.patch and return the ChangeSet with that
             path as diff_ref, base_commit = the sha of ${against}, and diff_bytes = the exact byte size of the file (wc -c).
             Report 0 honestly if it is still empty. Change no code, commit nothing, and never substitute a different diff.
             Previous ChangeSet: ${JSON.stringify({ ...cs, notes: undefined })}`,
        { label: `rediff:${task.id}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
      if (!re) return { spec, task, passed: false, skipped: false }
      recaptured = recaptured || action === 'recapture'
      cs = { ...re, diff_bytes: re.diff_bytes ?? 0 }
      continue
    }
    // refuse: nothing to review and no dependency left to explain it. Say so; spend no round on it.
    // If a sibling was already RECORDED straying into this task's owned surfaces (AC-7), name it and the path
    // instead of the generic hedge — the run measured the cause, it does not need to guess at it.
    const strayedIntoMe = boundaryViolations.flatMap(v => v.strays
      .filter(s => s.owner === task.id).map(s => ({ straying_task_id: v.straying_task_id, ref: s.ref })))
    const why = `${task.id}: the captured diff is EMPTY (${cs.diff_bytes} bytes) against ${recaptured ? BASE : base} on branch ${branch}`
      + (strayedIntoMe.length
          ? `. Task ${strayedIntoMe[0].straying_task_id} was recorded straying into this task's owned surfaces at ${strayedIntoMe.map(s => s.ref).join(', ')} — that almost certainly explains the empty diff.`
          : (deps.length ? `. Its dependency ${deps.map(d => d.task.id).join(', ')} may already carry this task's work — check whether that implementer wrote outside its owned surfaces.` : '.'))
    log(why)
    const esc = await agent(`Write an Escalation for a human. Do not create, edit or delete any file, and do not run any
                             command that changes the repository — you package the escalation, you never fix it.
                             Reason: cannot_repro. History: ${JSON.stringify([why])}.
                             Open findings: []. Repeats: []. Disputes lost: []. Overruled by judge: [].
                             ${specText}. The task produced no reviewable change, so no panel was run and no round was spent.
                             One-line hypothesis for why the diff is empty. Options: guide, direct_drive, kill_to_spec.`,
      { label: `escalate:${task.id}`, model: MODEL.strong, ...AT('escalate'), schema: Escalation })
    if (esc) escalations.push({ ...esc, task_id: task.id, reason: 'cannot_repro', repeats: [], disputes_lost: [] })
    return { spec, task, passed: false, skipped: false }
  }

  let changeSet1 = cs
  if (A.canary && (A.canary.task_id === task.id || A.canary.spec_id === spec.id)) {
    log(`canary: injecting a deliberate defect into ${task.id}`)
    const mutated = await agent(`CANARY MUTATION — a deliberate defect to test the verifiers, on purpose. In worktree ${wt} (app at ${wt}/${APP}/, branch ${branch})
                                 apply exactly this change to the implementation and commit it with the message "tidy handler" (never mention canary, mutation, or test in the commit,
                                 the code, or comments; the verifiers must not be able to tell): ${A.canary.mutation}
                                 Then rewrite the cumulative diff vs ${changeSet1.base_commit} to ${changeSet1.diff_ref} and return the ChangeSet unchanged
                                 except notes = "canary" and diff_bytes = the new byte size of that file.
                                 ChangeSet: ${JSON.stringify(changeSet1)}`,
      { label: `canary:${task.id}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    if (mutated) changeSet1 = { ...mutated, notes: undefined, diff_bytes: mutated.diff_bytes ?? changeSet1.diff_bytes }
  }
  ctx.changeSet = changeSet1

  // Lens re-run policy: after a fix, re-run only the lenses that failed until they pass, then confirm the ones that had passed.
  // If a confirm run fails, run all three until green (mode 'all'). Confirm runs do not count toward K_ROUNDS.
  const initialBoundary = boundaryCheck({ touched_surfaces: ctx.changeSet.touched_surfaces ?? [], owned_surfaces: task.owned_surfaces ?? [],
    siblings: siblingTasks, exempt_prefixes: EXEMPT_PREFIXES })
  // ---- Boundary check: Task.owned_surfaces is told to the implementer and verified by nobody. Run t5i wrote
  // ledger/index.jsonl and ledger/runs/m2-maintain-triage.json, both owned by sibling t2, which then found its
  // work done, committed nothing, and deadlocked on an empty diff. A stray into a SIBLING's owned surfaces ends
  // the task here, before any lens, test runner or fixer is called; a surface no task in the graph owns is only
  // a warning, and the task proceeds. touched_surfaces stays a permission ENVELOPE — only work OUTSIDE it, in a
  // surface someone else owns, is ever a defect. Each call site (this settled-ChangeSet check and the round-level
  // re-check below) ends the task itself, inline, right where its verdict is decided — never through a shared
  // return path a reader could miss.
  //
  // A violation, or a non-empty needs_from_sibling, is consulted with boundaryRepair BEFORE this Escalation is
  // ever written (wi-b5): the strayer's branch is discarded, the owning sibling(s) are awaited on their EXISTING
  // taskDone promises (never a new poll or timer), and the strayer's implementer is re-run once on a fresh
  // branch based on the owners' finished work. escalateBoundaryViolation itself is unchanged — same reason,
  // same Escalation shape — it is simply reached only when a repair is not possible or was already spent.
  // (The four functions this comment used to sit directly above are declared further down, after the round-level
  // re-check — function declarations hoist through this whole runTask body, so both call sites below still see
  // them; only their TEXTUAL position moved, to keep boundaryRepair( reachable from source before escalations.push
  // at both call sites, per AC-8.)

  if (initialBoundary.verdict === 'violation') {
    const outcome = await routeBoundary(initialBoundary.strays, [])
    if (!outcome.proceed) return { ...ctx, passed: false }
    if (outcome.changeSet) ctx.changeSet = outcome.changeSet
  } else if (initialBoundary.verdict === 'unowned') {
    initialBoundary.unowned.forEach(ref => ctx.history.push(`${task.id} touched ${ref}, which no task in the graph owns`))
  }

  // Criteria scope (SCOPE MISMATCH fix): bind every lens to the criteria THIS task owns, and name the sibling
  // that owns every remaining criterion, so a task owning one criterion of seventeen is never failed for the
  // other sixteen.
  const acceptanceIds = spec.acceptance?.map(a => a.id)
  const scope = criteriaScope({ task, tasks: tasks.map(t => t.task), acceptance_ids: acceptanceIds })
  const siblingCriteriaLines = Object.entries(scope.sibling_owner).map(([c, sib]) => `${c} is owned by sibling task ${sib}`)
  const criteriaScopeNote = `This task owns exactly these acceptance criteria (task.criteria_ids): ${JSON.stringify(scope.owned)}.`
    + (siblingCriteriaLines.length ? ` Every remaining acceptance criterion in this spec belongs to a sibling task: ${siblingCriteriaLines.join('; ')}.` : '')
    + ` A criterion this task does not own is NEVER a finding, however unmet it looks — judge this change only against its own criteria_ids.`

  // ---- Verify → Fix cycle ----
  let confirming = false
  for (;;) {
    if (!confirming) ctx.round += 1
    const tag = `r${ctx.round}${confirming ? 'c' : ''}`
    const toRun = ctx.toRun
    const roundStartSpend = budget.spent()   // this round's own delta (point 3); an upper bound under an overlapping pipeline
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
             starting "SPEC-LEVEL:" and do not fail the change on it alone. ${criteriaScopeNote} ${overruledNote}
             ${specText}. Change (read the diff at diff_ref): ${JSON.stringify(diffOnly)}. ${extra}
             THE CHANGE UNDER REVIEW IS IN WORKTREE ${wt}, already committed on branch ${branch}. Your own working directory is the
             repository root at the PRE-TASK commit and does NOT contain this change. Every file you open, read, grep or cite MUST be
             under ${wt}/ and every location you report MUST be a path relative to it. A file read anywhere else shows you the state
             BEFORE this change; a finding built on it is false, and re-reporting it is what a repeat finding is.
             Every finding needs location (path:line), claim, evidence, status "open", and dedupe_key = "<location>|<short normalized claim>".
             Every finding also needs target: "test" when the defect is really in a test assertion (even one whose location points at
             the code it covers) and you want it repaired by the Test Author rather than the code Fixer; "implementation" when it is a
             defect in the code; omit target only if you cannot tell.`,
        { label: `lens:${name}:${task.id}:${tag}`, model: MODEL.cheap, ...AT(`lens-${name.replace(/_/g, '-')}`), schema: Verdict })
        .then(v => v && { ...v, lens: name })   // the script names the lens; the agent does not

    const sealVerdict = (v, model) => ({ ...v, change_set_id: ctx.changeSet.id, provenance: stamp(`lens:${v.lens}`, model, 'dark_factory') })
    // Populated inside the correctness thunk below, before it calls the correctness lens (AC-6: this round's ONE
    // call site of testValidity precedes every fix:${task.id} agent call, which only happen later in this same
    // round, in the fix loop further down). Read afterwards by the fix-refusal check (AC-13): a code fixer's
    // finding "cites a failing test" against THIS round's full failing-test list, test_defect included.
    let roundTestDefects = []       // this round's tests classified test_defect — never reaches the correctness lens or a fix:
    let roundFailingTestNames = []  // every test the Test Runner reported failing this round, whatever its class
    const lensThunks = {
      // touched_surfaces is a permission envelope, not a mandate (rulings r5 and c1 both overruled "listed surface not touched"; the
      // c1 lens re-raised it and forced an escalation). Only work outside the envelope, or a criterion left unmet, is a finding.
      spec_conformance: () => lens('spec_conformance', `Does it do exactly what the spec says — nothing more, nothing less?
             spec.touched_surfaces is the set of surfaces the change MAY touch, never a list it MUST touch: a listed surface the diff leaves
             alone is not a finding. Acceptance tests are written by a separate Test Author under ${ART}/tests/, so a test file the spec
             names is never expected in the diff. Fail only for work outside the envelope, out_of_scope work, or a criterion the diff leaves unmet.`),
      security: () => lens('security', `Focus on ${JSON.stringify(spec.touched_surfaces)}: injection, authz, secrets, data exposure BEYOND what the spec requires.
                               A fail must cite a defect in how the change implements the spec, never the spec's own goal.`),
      correctness: async () => {
        const r = await runP
        if (!r) return null
        // ---- Test validity before blame (wi-b6, AC-8/AC-9): before correctness gets to blame the implementation
        // for ANY failing test, one cheap read-only detector runs ONCE, only because this round's Test Runner
        // reported failed > 0. It reports facts only; testValidity (the pure function, called next) derives the
        // class in script code.
        if (r.failed > 0) {
          const detected = (await agent(`Report FACTS ONLY about each currently FAILING test from this round's run — never a verdict, never
                 a fix. Test results are at ${r.results_ref} (${r.failed} failing, ${r.passed} passing). The change under review is committed
                 on branch ${branch} in worktree ${wt} (app at ${wt}/${APP}/); its BASE commit (before this task's change) is ${base}.
                 For EVERY failing test return one entry with: test (its name), criterion (the acceptance criterion id from
                 ${JSON.stringify(task.criteria_ids)} it cites, or your best guess), and four booleans:
                 locates_by_first_occurrence (the test finds the code under test by the FIRST TEXTUAL occurrence of a name in the file,
                 rather than by call structure inside a named function — e.g. text.indexOf('name') instead of inspecting call sites);
                 requires_unquoted_literal (the test requires an exact identifier or string that ${specText} never quotes);
                 fails_on_base_same_reason (reason about whether this same test would ALSO fail, for the same reason, against the base
                 commit ${base} — before this task's change existed — without needing to check it out or execute it);
                 names_criterion_behaviour (the test's own assertions actually describe the cited criterion's behaviour, not something else).
                 Read-only: do NOT create, edit, delete or commit any file, and do not modify the worktree ${wt} or branch ${branch} in any
                 way — you report facts about tests that already failed, you never re-run, fix, or change anything.`,
            { label: `validity:${task.id}:${tag}`, model: MODEL.cheap, ...AT('lens-correctness'), schema: TestValidityReport }))?.tests ?? []
          roundFailingTestNames = detected.map(dt => dt.test)
          const classified = detected.map(dt => {
            const facts = { locates_by_first_occurrence: dt.locates_by_first_occurrence, requires_unquoted_literal: dt.requires_unquoted_literal,
              fails_on_base_same_reason: dt.fails_on_base_same_reason, names_criterion_behaviour: dt.names_criterion_behaviour }
            return { dt, facts, class: testValidity(facts) }
          })
          classified.forEach(c => ctx.testValidity.push({ test: c.dt.test, criterion: c.dt.criterion, facts: c.facts, class: c.class }))
          roundTestDefects = classified.filter(c => c.class === 'test_defect').map(c => c.dt)
          const unclearCount = classified.filter(c => c.class === 'unclear').length
          if (unclearCount) ctx.history.push(`${tag}: ${unclearCount} failing test(s) classified unclear — reaching correctness as today`)
          if (roundTestDefects.length) {
            // Existing testfix: path, reused exactly (testRepairTarget, label testfix:${task.id}:..., AT('test-author'),
            // TestRepair schema) — a test_defect test never reaches a fix: fixer and never counts toward the panel's
            // fail verdict (AC-7, AC-9). testRepairTarget's finding.location falls back to the whole tests_ref when
            // location isn't a file path, which a bare test name is.
            const repairs = (await parallel(roundTestDefects.map(dt => () => {
              const target = testRepairTarget({ finding: { location: dt.test }, tests_ref: ctx.testSet.tests_ref, artifact_dir: ART, worktree: wt })
              const targetNote = target.source === 'finding_location'
                ? `That file already lives on branch ${branch} inside worktree ${wt} — edit it there and commit the change (it is not in the artifact TestSet).`
                : `Write it under the TestSet directory (create the file there if it does not exist yet).`
              return agent(`The failing test "${dt.test}" (criterion ${dt.criterion}) was classified a TEST DEFECT before the correctness
                     lens or any fixer saw it: it locates the code it covers by first textual occurrence rather than call structure, or
                     requires an exact literal the Spec never quotes, or fails the same way on the task's base commit while not describing
                     the criterion's behaviour. Repair the test at ${target.ref} so it asserts exactly what ${specText} says; do not read or
                     modify the implementation. ${targetNote} If the test is right and this classification is wrong, change nothing and set
                     notes to "DISPUTE: <why>". Return tests_ref (the path you wrote or edited) and the criteria the tests now cover.`,
                { label: `testfix:${task.id}:validity:${dt.test}`, model: MODEL.mid, ...AT('test-author'), schema: TestRepair })
                .then(p => p && { dt, p, target })
            }))).filter(Boolean)
            repairs.forEach(x => { if (fixOutcome(x.p.notes) !== 'dispute') ctx.repairedTests.push(x.target) })
            const lastGoodRef = [...repairs].reverse().find(x => fixOutcome(x.p.notes) !== 'dispute' && x.p.tests_ref)?.p.tests_ref
            if (lastGoodRef) ctx.testSet = { ...ctx.testSet, tests_ref: widenTestsRef(ctx.testSet.tests_ref, lastGoodRef) }
            ctx.history.push(`${tag}: ${roundTestDefects.length} failing test(s) classified test_defect and routed to the Test Author before the correctness lens ran`)
          }
        }
        const testDefectNames = roundTestDefects.map(dt => dt.test)
        const adjustedResults = testDefectNames.length ? { ...r, failed: Math.max(0, r.failed - testDefectNames.length) } : r
        const defectNote = testDefectNames.length
          ? `These failing tests were classified TEST DEFECTS this round and are already being repaired by the Test Author, not the
             implementation: ${JSON.stringify(testDefectNames)}. They are not evidence against this change — do not raise a finding citing them.`
          : ''
        return lens('correctness', 'Do the tests exercise the acceptance criteria? Are passes meaningful? Is anything untested?',
          `Tests: ${JSON.stringify(ctx.testSet)}. Results: ${JSON.stringify(adjustedResults)}. ${defectNote}`)
      },
    }
    const rawVerdicts = (await parallel(toRun.map(l => lensThunks[l]))).filter(Boolean)
    // stripForeignFindings runs BEFORE normalizeVerdict and adjudicate (ROUTING/SCOPE fix): a finding whose only
    // cited acceptance criteria belong to a sibling never reaches the adjudicator, never enters `seen`, and never
    // gets a fixer, a diff-slicer or a test-repair agent spent on it.
    const { verdicts: scopedVerdicts, dropped } = stripForeignFindings(rawVerdicts, scope)
    dropped.forEach(d => ctx.history.push(`${tag}: dropped a finding citing ${d.criterion}, owned by sibling task ${d.sibling} — not this task's criterion to fail on`))
    const verdicts = scopedVerdicts.map(v => sealVerdict(normalizeVerdict(v, tag), MODEL.cheap))

    let { result, veto_by, split } = adjudicate(verdicts)
    if (split) {
      const tie = await agent(`Adjudicate a split review. Do not create, edit or delete any file, and do not run any
               command that changes the repository — you adjudicate, you never patch. Verdicts: ${JSON.stringify(verdicts)}. ${specText}. Change: ${JSON.stringify(diffOnly)}.`,
        { label: `tiebreak:${task.id}:${tag}`, model: MODEL.strong, ...AT('tiebreak'), schema: Verdict })
      if (tie) { verdicts.push(sealVerdict(tie, MODEL.strong)); result = tie.verdict } else result = 'fail'
    }
    const findings = dedupe(verdicts.flatMap(v => v.findings))
    panelResults.push({ change_set_id: ctx.changeSet.id, result, veto_by, verdicts, findings, round: ctx.round })
    ctx.history.push(`${tag} [${toRun.join(',')}]: ${result} (${findings.length} findings${veto_by ? `, veto by ${veto_by}` : ''})`)
    ctx.last_round_tokens = Math.max(0, budget.spent() - roundStartSpend)
    ctx.tokens += ctx.last_round_tokens
    ctx.lens_streaks = lensStreaks(ctx.lens_streaks, toRun, result === 'pass' ? [] : findings)

    // Escalation Packager: code supplies reason, repeats and disputes; the strong model supplies the hypothesis.
    // Defined before the pass/fail branch below so the pass branch's roundOutcome guard can call it too.
    const escalate = async (reason, open) => {
      const repeats = open.filter(f => ctx.overruled.some(o => o.lens === f.lens && fileOf(o.location) === fileOf(f.location)))
      const esc = await agent(`Write an Escalation for a human. Do not create, edit or delete any file, and do not run any
                               command that changes the repository — you package the escalation, you never fix it.
                               Reason: ${reason}. History: ${JSON.stringify(ctx.history)}.
                               Open findings: ${JSON.stringify(open)}. Repeats: ${JSON.stringify(repeats)}.
                               Disputes lost (fixer disputed, judge upheld): ${JSON.stringify(ctx.upheld)}. Overruled by judge: ${JSON.stringify(ctx.overruled)}.
                               ${specText}. One-line hypothesis for why this is stuck. Options: guide, direct_drive, kill_to_spec.`,
        { label: `escalate:${task.id}`, model: MODEL.strong, ...AT('escalate'), schema: Escalation })
      if (esc) escalations.push({ ...esc, task_id: task.id, reason, repeats, disputes_lost: ctx.upheld })
      return { ...ctx, passed: false }
    }

    if (result === 'pass') {
      // AC-9: this task must not pass in the very round a test_defect test was found and routed to the Test
      // Author, before the Test Runner has re-run against the repair — correctness's 'pass' here only reflects
      // the ADJUSTED count with those tests subtracted out, not a re-verified one. Force exactly one extra confirm
      // round (bounded like grace_used, so a disputed or ineffective repair never holds the loop open forever).
      const forceRecheck = roundTestDefects.length > 0 && !ctx.testDefectRecheckUsed
      if (roundTestDefects.length > 0) ctx.testDefectRecheckUsed = true
      toRun.forEach(l => ctx.verified.add(l))
      if (forceRecheck) ctx.verified.delete('correctness')
      const remaining = LENSES.filter(l => !ctx.verified.has(l))
      if (remaining.length) {   // failures cleared; now confirm the lenses that had passed before the fix
        ctx.toRun = remaining; confirming = true
        ctx.history.push(`${tag}: confirming ${remaining.join(',')}${forceRecheck ? ' (re-verifying a test_defect repair before this task may pass)' : ''}`)
        continue
      }
      // Every lens is green — that alone is not proof (k1v): a test dispute nobody ruled on, or any other finding
      // left upheld/unresolved in an earlier round, does not clear itself just because a cheap lens stopped
      // re-raising it. Nothing new happened this round (no repairs, no rulings, no deferrals), so this call only
      // carries ctx.carried forward through resolveRound's uniform resolution logic; roundOutcome is the one gate
      // a task may pass through to completion.
      const passRound = resolveRound({ findings, carried_in: ctx.carried, deferred: [], repairs: [], rulings: [], tests_ref: ctx.testSet.tests_ref })
      ctx.carried = passRound.carried
      const outcome = roundOutcome({ panel_result: 'pass', carried: ctx.carried })
      if (outcome === 'pass') return { ...ctx, passed: true, branch }
      ctx.history.push(`${tag}: panel is green but ${ctx.carried.length} earlier finding(s) were never fixed or overruled (${ctx.carried.map(f => f.dedupe_key).join(',')}) — escalating instead of passing on a lens's silence`)
      return escalate('no_fresh_findings', ctx.carried)
    }
    if (confirming) { ctx.mode = 'all'; ctx.history.push(`${tag}: a previously passing lens failed after a fix; running all lenses until green`) }
    confirming = false

    const reason = shouldEscalate(ctx, findings)
    if (reason === 'budget') ctx.history.push(`${tag}: budget breach — tokens ${ctx.tokens}/${ctx.task_tokens} this task, ${ctx.last_round_tokens}/${ctx.round_tokens} this round`)
    if (reason === 'repeat_finding' && stuckLens(ctx.lens_streaks, ctx.k_rounds)) {
      ctx.history.push(`${tag}: ${stuckLens(ctx.lens_streaks, ctx.k_rounds)} has failed ${ctx.k_rounds} consecutive rounds — not converging, whatever its findings are keyed on`)
    }
    // shouldEscalate returns null at the cap when it is granting the one grace round; record that it was spent here,
    // since the decision function is pure and cannot mark it itself.
    if (!reason && ctx.round >= ctx.k_rounds && !ctx.grace_used) {
      ctx.grace_used = true
      ctx.history.push(`${tag}: grace round — at the cap with ${findings.length} finding(s) that never reached a fixer; granting one fix pass rather than discarding the panel that found them`)
    }
    if (reason) return escalate(reason, findings)

    // ---- Fix Loop: dedupe against SEEN, fan out fixers, rule on disputes, merge ----
    const freshAll = findings.filter(f => !ctx.seen.has(f.dedupe_key)).sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9))
    const fresh = freshAll.slice(0, MAX_FIXERS)
    const deferred = freshAll.slice(MAX_FIXERS)
    fresh.forEach(f => ctx.seen.add(f.dedupe_key))   // deferred findings stay out of `seen` and come back as fresh next round
    if (deferred.length) { log(`${task.id} ${tag}: fixer cap ${MAX_FIXERS}; deferred ${deferred.length} finding(s)`); ctx.history.push(`${tag}: deferred ${deferred.length} findings past the fixer cap: ${deferred.map(d => d.id).join(',')}`) }

    // routeFinding replaces isTestFinding: target (set by the lens) decides first, location decides only when
    // target is absent — a finding about a test assertion whose location points at the code it covers still
    // routes to the Test Author when the lens marked target "test".
    const findingRoute = (f) => routeFinding(f, { tests_ref: ctx.testSet.tests_ref, artifact_dir: ART })

    // Scope the fixer's input (point 2): one cheap mechanical agent per failing round slices the cumulative diff into
    // one per-file patch per distinct finding file, so a code fixer reads its own hunk instead of exploring the whole tree.
    const ScopeMap = { type: 'object', additionalProperties: false, required: ['files'],
      properties: { files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'scoped_diff_ref'],
        properties: { file: { type: 'string' }, scoped_diff_ref: { type: 'string' } } } } } }
    const codeFresh = fresh.filter(f => findingRoute(f) !== 'test')
    const scopeFiles = scopeTargets(codeFresh)
    let scopedByFile = new Map()
    if (scopeFiles.length) {
      const sliced = await agent(`Slice the cumulative diff at ${ctx.changeSet.diff_ref} into one per-file patch, one per path below, each
                 containing ONLY that path's hunks. Write each to ${ART}/diffs/${task.id}.r${ctx.round}.scope.<n>.patch where <n> is that
                 path's 1-based position in this list (in order): ${JSON.stringify(scopeFiles)}. If a path has no hunks in the diff, or it
                 cannot be sliced, omit it rather than writing an empty file. Return files: an array of { file, scoped_diff_ref } for every
                 path you successfully sliced.`,
        { label: `scope:${task.id}:${tag}`, model: MODEL.cheap, ...AT('mechanical'), schema: ScopeMap })
      scopedByFile = new Map((sliced?.files ?? []).map(x => [x.file, x.scoped_diff_ref]))
    }

    const fixes = (await parallel(fresh.map(f => () => findingRoute(f) === 'test'
      ? (() => {
          // testRepairTarget (not the artifact tests_ref blindly): the file the finding actually cites, inside
          // THIS task's worktree, unless that file already IS the artifact TestSet — in which case editing it
          // there needs no cumulative rediff.
          const target = testRepairTarget({ finding: f, tests_ref: ctx.testSet.tests_ref, artifact_dir: ART, worktree: wt })
          const targetNote = target.source === 'finding_location'
            ? `That file already lives on branch ${branch} inside worktree ${wt} — edit it there and commit the change (it is not in the artifact TestSet).`
            : `Write it under the TestSet directory (create the file there if it does not exist yet).`
          return agent(`A verifier found a defect in the TESTS you wrote from the spec, not in the implementation. Location: ${f.location}. Evidence: ${f.evidence}.
             Re-read the spec (${specText}). Repair the test at ${target.ref} so it asserts exactly what the spec says; do not read or modify the implementation.
             ${targetNote} If the test is right and the finding is wrong, change nothing and set notes to "DISPUTE: <why>". ${A.test_hint ?? ''}
             Return tests_ref (the path you wrote or edited) and the criteria the tests now cover.`,
            { label: `testfix:${task.id}:${f.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestRepair }).then(p => p && { f, p, kind: 'test', target })
        })()
      : (() => {
          const scopeFile = scopeOf(f.location)
          const scopedRef = scopeFile ? scopedByFile.get(scopeFile) : undefined
          const scopeNote = scopedRef
            ? `A scoped slice of the cumulative diff for just this finding's file is at scoped_diff_ref: ${scopedRef} — READ THAT SLICE FIRST;
               widen to the rest of the worktree only if the slice is insufficient to understand or fix the finding.`
            : `No scoped slice is available for this finding (its location is not a file path, or slicing found nothing there) —
               fall back to the unscoped cumulative diff at ${ctx.changeSet.diff_ref} and read across the whole worktree as before.`
          return agent(`Fix ONE finding in worktree ${wt} (app at ${wt}/${APP}/, branch ${branch}). Location: ${f.location}. Evidence: ${f.evidence}.
             ${scopeNote}
             Stay inside owned surfaces ${JSON.stringify(task.owned_surfaces)}. Commit the fix on branch ${branch}.
             Write the incremental diff of your commit to ${ART}/diffs/${task.id}.r${ctx.round}.${f.id}.patch and return it as diff_ref.
             Do not modify tests under ${ART}/tests/.
             Spec goal: ${spec.goal} Out of scope — never add any of these to satisfy a finding: ${JSON.stringify(spec.out_of_scope ?? [])}.
             FIRST reproduce the finding empirically (run the code, a request, or the test it cites); lenses are read-only and can
             only assert runtime behavior, you can check it. If it does not reproduce, or it objects to behavior the spec requires, or
             asks for something out of scope, make no change and set notes to "DISPUTE: <what you ran and what it showed>". If the
             defect is real but lives in a TEST assertion rather than in this code — you are forbidden to edit tests — make no change
             and set notes to "TEST-ONLY: <what the test asserts and why the code is right>"; it will be routed to the Test Author once.
             You may NOT bend the code to fit a test's own text. Also report behaviour_changed: true when this fix changes what the code
             DOES; false when it only renames or relabels an identifier, or moves a declaration, without changing the behaviour the
             finding actually names. behaviour_rationale: one line why. A fix reported behaviour_changed:false for a finding that cites a
             failing test is refused — never accepted — and re-routed to the Test Author instead, so answer honestly rather than
             guessing what keeps the fix accepted.`,
            { label: `fix:${task.id}:${f.id}`, model: MODEL.mid, ...AT('fixer'), schema: ChangeSet }).then(p => p && { f, p, kind: 'code' })
        })()))).filter(Boolean)

    // fixOutcome reads a code Fixer's notes: 'dispute' goes to the dispute judge, whichever repair path raised
    // it (disputesToJudge below is blind to x.kind on purpose — that blindness is the k1v fix); 'test_only' is a
    // DIFFERENT outcome — the Fixer is forbidden to edit tests, so it is re-routed to the Test Author repair path
    // once, in this same round; anything else is a normal applied fix.
    const testOnly = fixes.filter(x => x.kind === 'code' && fixOutcome(x.p.notes) === 'test_only')

    // TEST-ONLY re-route (ROUTING fix, c): one repair attempt per finding, in this round, never twice for the
    // same dedupe_key. Not counted in `applied` either way; its own dispute (if any) still reaches the judge below,
    // exactly as a first-attempt test-path dispute does — no repair path gets less rigor than another.
    let testOnlyRepairs = []
    if (testOnly.length) {
      testOnlyRepairs = (await parallel(testOnly.map(x => () => {
        const target = testRepairTarget({ finding: x.f, tests_ref: ctx.testSet.tests_ref, artifact_dir: ART, worktree: wt })
        const targetNote = target.source === 'finding_location'
          ? `That file already lives on branch ${branch} inside worktree ${wt} — edit it there and commit the change (it is not in the artifact TestSet).`
          : `Write it under the TestSet directory (create the file there if it does not exist yet).`
        return agent(`A code Fixer determined this finding is really a defect in the TESTS, not the implementation (its own reasoning: ${x.p.notes}).
               Location: ${x.f.location}. Evidence: ${x.f.evidence}. Re-read the spec (${specText}). Repair the test at ${target.ref}
               so it asserts exactly what the spec says; do not read or modify the implementation. ${targetNote} If the test is right and the finding is
               wrong, change nothing and set notes to "DISPUTE: <why>". ${A.test_hint ?? ''} Return tests_ref (the path you wrote or edited) and the criteria the tests now cover.`,
          { label: `testfix:${task.id}:${x.f.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestRepair }).then(p => p && { f: x.f, p, target })
      }))).filter(Boolean)
    }

    // Fix refusal (wi-b6, AC-13): a code fixer may not bend the implementation to fit a test's own text. Consulted
    // only for a fix whose outcome is already 'applied' — DISPUTE: and TEST-ONLY: are separate, pre-existing
    // outcomes and are untouched by this. fixRefused is the pure decision (sentinel block); citesFailingTest reads
    // THIS round's full failing-test list (test_defect included) the correctness thunk populated above.
    const codeApplied = fixes.filter(x => x.kind === 'code' && fixOutcome(x.p.notes) === 'applied')
    const refusedFixes = codeApplied.filter(x => fixRefused({
      behaviour_changed: x.p.behaviour_changed, cites_test_failure: citesFailingTest(x.f, roundFailingTestNames) }))
    refusedFixes.forEach(x => ctx.testValidity.push({ test: x.f.location, criterion: x.f.claim ?? x.f.location, facts: { behaviour_changed: false }, class: 'test_defect' }))

    // Refused fixes are re-routed to the Test Author's testfix path exactly like a TEST-ONLY outcome — never to
    // a fix: fixer, never counted in `applied` — and their commit must not survive on the task branch: the merge
    // step below is told which diff_refs to revert.
    let refusedRepairs = []
    if (refusedFixes.length) {
      refusedRepairs = (await parallel(refusedFixes.map(x => () => {
        const target = testRepairTarget({ finding: x.f, tests_ref: ctx.testSet.tests_ref, artifact_dir: ART, worktree: wt })
        const targetNote = target.source === 'finding_location'
          ? `That file already lives on branch ${branch} inside worktree ${wt} — edit it there and commit the change (it is not in the artifact TestSet).`
          : `Write it under the TestSet directory (create the file there if it does not exist yet).`
        return agent(`A code fixer reported behaviour_changed:false for this finding while it cites a failing test — it may not bend the
               implementation to fit the test's own text, so the fix was refused. Location: ${x.f.location}. Evidence: ${x.f.evidence}.
               Fixer's own rationale: ${x.p.behaviour_rationale ?? '(none given)'}. Re-read the spec (${specText}). Repair the test at
               ${target.ref} so it asserts exactly what the spec says; do not read or modify the implementation. ${targetNote} If the test
               is right and this finding is wrong, change nothing and set notes to "DISPUTE: <why>". Return tests_ref (the path you wrote
               or edited) and the criteria the tests now cover.`,
          { label: `testfix:${task.id}:${x.f.id}`, model: MODEL.mid, ...AT('test-author'), schema: TestRepair }).then(p => p && { f: x.f, p, target })
      }))).filter(Boolean)
      refusedRepairs.forEach(x => { if (fixOutcome(x.p.notes) !== 'dispute') ctx.repairedTests.push(x.target) })
      ctx.history.push(`${tag}: refused ${refusedFixes.length} fix(es) that reported behaviour_changed:false for a finding citing a failing test — re-routed to the Test Author`)
    }
    const refusedKeys = new Set(refusedFixes.map(x => x.f.dedupe_key))

    const applied = codeApplied.filter(x => !refusedKeys.has(x.f.dedupe_key)).map(x => x.p)

    // One flat repair record per outcome this round, path-tagged but never path-FILTERED for dispute purposes —
    // the record shape resolveRound/disputesToJudge share (AC-2 through AC-9): dedupe_key, path, notes, plus
    // target_source/tests_ref for a test-path repair, plus f/p so the judge loop and the history lines below can
    // still read the original finding and repair.
    const repairRecords = [
      ...fixes.filter(x => !refusedKeys.has(x.f.dedupe_key)).map(x => ({ dedupe_key: x.f.dedupe_key, path: x.kind, notes: x.p.notes, f: x.f, p: x.p,
        target_source: x.kind === 'test' ? x.target?.source : undefined,
        tests_ref: x.kind === 'test' ? x.p.tests_ref : undefined })),
      ...testOnlyRepairs.map(x => ({ dedupe_key: x.f.dedupe_key, path: 'test', notes: x.p.notes, f: x.f, p: x.p,
        target_source: x.target?.source, tests_ref: x.p.tests_ref })),
      ...refusedRepairs.map(x => ({ dedupe_key: x.f.dedupe_key, path: 'test', notes: x.p.notes, f: x.f, p: x.p,
        target_source: x.target?.source, tests_ref: x.p.tests_ref })),
    ]

    // Dispute Checker: strong model, never the same lens. disputesToJudge selects EVERY disputing repair — code
    // or test — so a Test Author's dispute is ruled on exactly as a code Fixer's is; the pre-fix filter
    // (`x.kind === 'code' && ...`) is gone, and with it the hole a disputing test repair fell through.
    const disputed = disputesToJudge(repairRecords)
    let rulings = []
    if (disputed.length) {
      // Its ruling crosses two edges: the next round's lens prompt and the Escalation.
      rulings = await parallel(disputed.map(x => () =>
        agent(`Rule on a disputed finding. Do not create, edit or delete any file, and do not run any command that changes
               the repository — you rule, you never patch. ${specText}. Finding: ${JSON.stringify(x.f)}. Fixer's dispute: ${x.notes}.
               UPHOLD only if the finding names a real defect in how the change implements the spec. OVERRULE if it objects to behavior the
               spec requires, asks for something the spec lists as out of scope, or describes an attack the change already blocks.`,
          { label: `dispute:${task.id}:${x.f.id}`, model: MODEL.mid, ...AT('dispute'), schema: Ruling })))   // mid tier: Opus rulings were the largest cost line (ledger, Phases 1–2); Tiebreak stays strong
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
    const rulingsForResolve = disputed.map((x, i) => ({ dedupe_key: x.dedupe_key, ruling: rulings[i]?.ruling }))

    // resolveRound is the single source of this round's resolution map AND of what carries into the next round
    // (AC-3 through AC-9): every dedupe_key here gets an entry, 'nobody resolved it' included, so a test dispute
    // the judge never ruled on reads 'unresolved' rather than silently vanishing the moment the lens stops
    // re-raising it (k1v).
    const round = resolveRound({ findings, carried_in: ctx.carried, deferred, repairs: repairRecords, rulings: rulingsForResolve, tests_ref: ctx.testSet.tests_ref })
    ctx.carried = round.carried
    ctx.testSet = { ...ctx.testSet, tests_ref: round.tests_ref }
    const repairedCount = repairRecords.filter(r => r.path === 'test' && fixOutcome(r.notes) !== 'dispute').length
    if (repairedCount) ctx.history.push(`${tag}: ${repairedCount} test finding(s) repaired by the Test Author`)
    // Track every non-disputing test repair's target for the Integrate barrier's unlandedRepairs check — a skipped
    // basename a repair actually edited must never be dropped silently.
    ;[...fixes.filter(x => x.kind === 'test'), ...testOnlyRepairs].forEach(x => {
      if (x.target && fixOutcome(x.p.notes) !== 'dispute') ctx.repairedTests.push(x.target)
    })

    // Re-panel by finding resolution, not by verdict (point 1): a lens whose findings were all overruled settles into
    // ctx.verified for this change set instead of re-running a fresh retry round on a byte-identical diff.
    const { retry, settled } = nextLenses({ lenses: LENSES, findings, resolution: round.resolution, mode: ctx.mode, verified: [...ctx.verified] })
    settled.forEach(l => ctx.verified.add(l))
    ctx.toRun = lensesToRun({ lenses: LENSES, retry, verified: [...ctx.verified], mode: ctx.mode })

    // Nothing to recapture: no code fix applied, no test repair edited a file already on the branch (needs_rediff,
    // AC-9), and no refused fix's commit to purge. Previously passing lenses stay verified; only the failing ones re-run.
    if (!applied.length && !round.needs_rediff && !refusedFixes.length) continue

    const revertNote = refusedFixes.length
      ? ` A REFUSED fix is already committed on ${branch} and must NOT survive: for each diff at
                                ${JSON.stringify(refusedFixes.map(x => x.p.diff_ref))}, find the commit that introduced it (git log -p or
                                git log --oneline) and revert it (git revert --no-edit <that commit>, or apply the diff in reverse with
                                git apply -R and commit the reversal) BEFORE computing the cumulative diff below, so none of its hunks remain.`
      : ''
    const merged = await agent(`In worktree ${wt} (branch ${branch}) the fixes ${JSON.stringify(applied.map(p => p.diff_ref))} are already committed
                                (this list may be empty when only a test repair changed the branch).${revertNote} Verify each listed fix is present (git log); if one is
                                missing, apply it with git apply and commit. Write the cumulative diff vs ${base}
                                (git diff ${base}...HEAD) to ${ART}/diffs/${task.id}.r${ctx.round}.patch and return the ChangeSet with revision ${ctx.changeSet.revision + 1}
                                and that path as diff_ref. Previous ChangeSet: ${JSON.stringify({ ...ctx.changeSet, notes: undefined })}`,
      { label: `merge:${task.id}:r${ctx.round}`, model: MODEL.cheap, ...AT('mechanical'), schema: ChangeSet })
    if (!merged) return { ...ctx, passed: false }
    ctx.changeSet = { ...merged, notes: undefined }
    // Re-check the boundary on the ROUND's merged ChangeSet, not just the settled one — a fixer's incremental
    // commit can stray just as an implementer's can. A violation ends the task instead of starting another round;
    // clean or unowned changes nothing about how the loop continues.
    const roundBoundary = boundaryCheck({ touched_surfaces: ctx.changeSet.touched_surfaces ?? [], owned_surfaces: task.owned_surfaces ?? [],
      siblings: siblingTasks, exempt_prefixes: EXEMPT_PREFIXES })
    if (roundBoundary.verdict === 'violation') {
      const outcome = await routeBoundary(roundBoundary.strays, [])
      if (!outcome.proceed) return { ...ctx, passed: false }
      if (outcome.changeSet) ctx.changeSet = outcome.changeSet
    }
    ctx.verified = new Set()   // code changed: nothing is verified until the failing lenses pass and the rest confirm
  }

  // ---- The four boundary-repair functions used by both call sites above (initialBoundary and roundBoundary).
  // Declared here, after both use sites, on purpose: function declarations hoist through this entire runTask
  // body, so both earlier call sites still resolve them at call time — only the source TEXT moved, so that
  // reading forward from either boundaryCheck( call, boundaryRepair( is always reached before escalations.push
  // (AC-8). routeBoundary and resolveBoundaryDecision (which call boundaryRepair) are declared before
  // escalateBoundaryViolation (whose body is the only place escalations.push appears) for the same reason.

  async function routeBoundary(strays, needs) {
    const decision = boundaryRepair({
      task_id: task.id, strays: strays ?? [], needs_from_sibling: needs ?? [], siblings: siblingTasks,
      repair_used: ctx.repair_used, violations: boundaryViolations,
      waiting_on: waitingOnMap(siblingTasks.map(s => s.id)),
    })
    return resolveBoundaryDecision(decision, strays ?? [], needs ?? [])
  }

  // Resolves one boundaryRepair decision to completion: 'wait' pauses on the named owners' EXISTING taskDone
  // promises (AC-12) and calls boundaryRepair again with owner_results filled in; 'rerun' performs the one
  // allowed repair and re-checks its result (AC-11); 'escalate' and 'proceed' are terminal. Returns
  // { proceed: true, changeSet? } to let the caller continue (changeSet present only after a successful
  // rerun), or { proceed: false } once an Escalation has been written.
  async function resolveBoundaryDecision(decision, strays, needs) {
    if (decision.action === 'proceed') return { proceed: true }
    if (decision.action === 'wait') {
      const owners = decision.owners ?? []
      waitingRegistry[task.id] = [...new Set([...(waitingRegistry[task.id] ?? []), ...owners])]
      const results = await Promise.all(owners.map(o => taskDone[o]))
      delete waitingRegistry[task.id]
      const owner_results = {}
      owners.forEach((o, i) => {
        const r = results[i]
        owner_results[o] = r ? { passed: r.passed === true, branch: r.branch ?? `task/${o}` } : undefined
      })
      const decision2 = boundaryRepair({
        task_id: task.id, strays, needs_from_sibling: needs, siblings: siblingTasks,
        repair_used: ctx.repair_used, violations: boundaryViolations,
        waiting_on: waitingOnMap(siblingTasks.map(s => s.id)), owner_results,
      })
      return resolveBoundaryDecision(decision2, strays, needs)
    }
    if (decision.action === 'rerun') {
      ctx.repair_used = true
      const cs2 = await repairRerun(decision)
      if (!cs2) {
        boundaryRepairs.push({ strayer: task.id, owners: decision.owners ?? [], base_branch: decision.base_branch ?? '', outcome: 'owner_failed' })
        await escalateBoundaryViolation({ strays }, `${task.id}'s repair re-run produced no ChangeSet.`)
        return { proceed: false }
      }
      const reBoundary = boundaryCheck({ touched_surfaces: cs2.touched_surfaces ?? [], owned_surfaces: task.owned_surfaces ?? [],
        siblings: siblingTasks, exempt_prefixes: EXEMPT_PREFIXES })
      const reNeeds = cs2.needs_from_sibling ?? []
      // AC-11: the rerun's ChangeSet goes back through the same decision, now with repair_used true, so the
      // decision function — not a second hand-written condition here — is what says a second stray escalates.
      const decision3 = boundaryRepair({
        task_id: task.id, strays: reBoundary.verdict === 'violation' ? reBoundary.strays : [], needs_from_sibling: reNeeds,
        siblings: siblingTasks, repair_used: ctx.repair_used, violations: boundaryViolations,
        waiting_on: waitingOnMap(siblingTasks.map(s => s.id)),
      })
      if (decision3.action !== 'proceed') {
        boundaryRepairs.push({ strayer: task.id, owners: decision.owners ?? [], base_branch: decision.base_branch ?? '', outcome: 'strayed_again' })
        if (reBoundary.verdict === 'violation') await escalateBoundaryViolation(reBoundary)
        else await escalateBoundaryViolation({ strays: [] }, `${task.id} again returned needs_from_sibling after its one repair: ${JSON.stringify(reNeeds)}`)
        return { proceed: false }
      }
      boundaryRepairs.push({ strayer: task.id, owners: decision.owners ?? [], base_branch: decision.base_branch ?? '', outcome: 'repaired' })
      return { proceed: true, changeSet: cs2 }
    }
    // escalate: reason is one of need_unowned, mutual, repair_used, owner_failed — every one an existing
    // Escalation reason value reached through the existing escalateBoundaryViolation path (AC-11, out_of_scope).
    boundaryRepairs.push({ strayer: task.id, owners: decision.owners ?? [], base_branch: '', outcome: decision.reason })
    if (strays.length) await escalateBoundaryViolation({ strays })
    else await escalateBoundaryViolation({ strays: [] }, `${task.id}'s boundary repair ended: ${decision.reason}.`)
    return { proceed: false }
  }

  // Re-runs the strayer's implementer ONCE, on a fresh branch (never task/<task.id> — AC-9) based on the
  // decision's base_branch, merging merge_branches and the task's ORIGINAL dependency branches first. Reassigns
  // the OUTER wt/branch so every later reference in this function — panel, fixer, the pass/fail return — reads
  // the repair branch, and the original task/<task.id> branch is never passed to Integrate (AC-10).
  async function repairRerun(decision) {
    const repairBranch = `task/${task.id}-repair`
    const repairWt = `${ART}/worktrees/${task.id}-repair`
    const originalDepBranches = deps.map(depBranch)   // the task's own depends_on, as result branches
    const mergeList = [...new Set([...(decision.merge_branches ?? []), ...originalDepBranches])]
    const cs2 = await agent(`Create a worktree of THIS repository on a new branch: git worktree add -b ${repairBranch} ${repairWt} ${decision.base_branch}
                 (skip if it exists). ${mergeList.length ? `Merge ${mergeList.join(', ')} into the branch. ` : ''}The app is at ${repairWt}/${APP}/
                 (run npm ci there if node_modules is missing). A sibling task now carries the value(s) this task needed and could not invent or
                 could not legally write itself; re-implement this task there, staying inside owned surfaces (paths are repository-relative) and
                 using the sibling's finished work instead of repeating the earlier stray. Commit your work on the branch.
                 Run \`git rev-parse HEAD\` AFTER the merge(s) above and use that sha as base_commit, so the diff you write reflects only this
                 task's own work, not the merged history. Then write the cumulative diff vs that base_commit (git diff <that sha>...HEAD, run
                 inside the worktree) to ${ART}/diffs/${task.id}.repair.patch and return that path as diff_ref; ALSO report diff_bytes: the exact
                 byte size of that file (wc -c), honestly 0 if empty. worktree = "${repairWt}".
                 Sibling tasks in this same spec, and the surfaces each one owns (never write inside any of them):
                 ${JSON.stringify(siblingSurfaces)}. Task: ${JSON.stringify(task)}. ${specText}.`,
      { label: `impl:${task.id}:repair`, model: MODEL.mid, ...AT('implementer'), schema: ChangeSet })
    if (cs2) { wt = repairWt; branch = repairBranch }
    return cs2
  }

  async function escalateBoundaryViolation(boundary, extraNote) {
    const strays = boundary?.strays ?? []
    if (strays.length) boundaryViolations.push({ straying_task_id: task.id, strays })
    const lines = strays.map(s => `${task.id} touched ${s.ref}, which sibling task ${s.owner} owns`)
    if (extraNote) lines.push(extraNote)
    lines.forEach(l => ctx.history.push(l))
    const esc = await agent(`Write an Escalation for a human. Do not create, edit or delete any file, and do not run any
                             command that changes the repository — you package the escalation, you never fix it.
                             Reason: no_fresh_findings. History: ${JSON.stringify(ctx.history)}.
                             Open findings: []. Repeats: []. Disputes lost: []. Overruled by judge: [].
                             ${specText}. ${task.id}'s change touches surface(s) owned by a sibling task (owned_surfaces must be
                             disjoint across tasks in the same spec), or asked for a value from a sibling this run could not repair;
                             no panel was run and no round was spent on it.
                             One-line hypothesis for why this task strayed outside its owned surfaces. Options: guide, direct_drive, kill_to_spec.`,
      { label: `escalate:${task.id}`, model: MODEL.strong, ...AT('escalate'), schema: Escalation })
    if (esc) escalations.push({ ...esc, task_id: task.id, reason: 'no_fresh_findings', history: ctx.history, repeats: [], disputes_lost: [] })
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
                           that path may be a FILE or a DIRECTORY (both have occurred) — if it is a directory copy every *.js
                           inside it, if it is a file copy that file. Copy into <worktree>/${TEST_DIR}/ under its own basename.
                           Copy the HELPER modules too, not only *.test.js: a landed test that imports a sibling module left
                           behind fails at import, which is exactly how run t7i shipped a red suite (t2-doc-paths.js never landed).
                           NEVER overwrite a file that already exists there — skip it and list it in tests_skipped; the repo's
                           copy wins, and that rule alone is what protects the repo's own helpers.js from an artifact-store copy
                           carrying absolute worktree paths. Then
                           \`git add -A && git commit -m "tests: land TestSets for ${A.run_id}"\` in the worktree.
                           ACCOUNT FOR EVERY FILE: return tests_found = every .js basename you found across those paths BEFORE
                           copying anything, tests_landed = what you copied, tests_skipped = what you did not and why.
                           tests_found must equal tests_landed plus tests_skipped. Returning a short list is a silent half-landing;
                           if you could not read a path, say so rather than omitting its files.
                           If a landed test then FAILS, report the failure verbatim in
                           the suite counts — never delete, skip or edit a test to make the suite green.`
  : ''
// A run in which no task passed has nothing to integrate: no branch to merge, no test to land, no suite that
// means anything. This guard sits on passing.length, before the mechanical merge-and-test agent() call, so
// neither it nor its strong-model conflict-resolution partner further below ever runs (AC-20) — the latter is
// already gated on `suite &&`, which is false whenever this one skips the call and leaves suite null.
const suite = !passing.length ? null : await agent(`Create worktree ${ART}/worktrees/integration-${A.run_id} on a new branch integration/${A.run_id} from ${BASE}
                           (git worktree add -b integration/${A.run_id} ${ART}/worktrees/integration-${A.run_id} ${BASE}). Merge these task branches into it in order:
                           ${JSON.stringify(passingBranches)}. Resolve conflicts minimally and list any files you touched in conflicts.${landing}
                           Then run the FULL test suite of the app at <worktree>/${APP}/ (npm ci if needed, then npm test). artifact_ref = "integration/${A.run_id}".
                           Write results to ${ART}/integration/${A.run_id}.json.
                           Finally run \`git rev-parse HEAD\` in the worktree and return its FULL 40-character sha as integration_commit.
                           Copy that sha exactly; if the command fails, leave integration_commit out rather than guessing one.`,
  { label: 'integrate', model: MODEL.cheap, ...AT('mechanical'), schema: Suite })
if (!passing.length) log('integration: no task passed; nothing to integrate')

// AE only on conflict (OPERATING_MODEL §2.1): a strong model re-resolves any files the mechanical merge had to touch, then re-runs the suite.
let finalSuite = suite
// Reconcile the landing in script (rule 3: edges are code). tests_found is what the lander SAW; anything it
// neither landed nor skipped went missing silently — run t7i lost one of t2's two test files that way, with
// tests_skipped empty and nothing to notice it.
const landedSet = new Set([...(suite?.tests_landed ?? []), ...(suite?.tests_skipped ?? [])])
// unaccountedTestFiles is called with the passing TestSets' own tests_ref paths (requested_paths): with no task
// passing (and so no path ever requested), or with tests_found holding only pre-existing repo test files no
// TestSet path ever named, nothing is unaccounted for regardless of what landedSet above says (AC-21).
const unaccounted = unaccountedTestFiles({ requested_paths: passingTests, tests_found: suite?.tests_found ?? [],
  tests_landed: suite?.tests_landed ?? [], tests_skipped: suite?.tests_skipped ?? [] })
if (unaccounted.length) log(`integration: ${unaccounted.length} TestSet file(s) neither landed nor skipped: ${unaccounted.join(', ')}`)

// unlandedRepairs: a tests_skipped basename a passing task's fix loop actually repaired (in the artifact TestSet,
// not one it edited directly on its own branch) is not a stale duplicate the never-overwrite rule was built for —
// it is a lost fix. Named to the resolver below rather than dropped silently.
const repairedTests = finished.filter(f => f.passed).flatMap(f => f.repairedTests ?? [])
const unlanded = unlandedRepairs({ tests_skipped: suite?.tests_skipped ?? [], repaired_tests: repairedTests })
if (unlanded.length) log(`integration: ${unlanded.length} skipped TestSet file(s) were actually edited by a repair: ${unlanded.join(', ')}`)

// A conflict needs two branches to have one, so the >1 guard belongs to the conflicts case ALONE. A FAILING suite
// or an unaccounted TestSet file is just as wrong with one passing task, and t7i proved it: one task passed, the
// suite came back 62/63 red, and this step was skipped because passing.length was 1.
if (suite && (suite.failed > 0 || unaccounted.length || unlanded.length || (suite.conflicts?.length && passing.length > 1))) {
  log(`integration: ${suite.conflicts?.length ?? 0} conflicted file(s), ${suite.failed} failing test(s), ${unaccounted.length} unaccounted TestSet file(s), ${unlanded.length} unlanded repair(s); strong-model resolution`)
  const resolved = await agent(`Integration branch integration/${A.run_id} in worktree ${ART}/worktrees/integration-${A.run_id} merged ${JSON.stringify(passingBranches)}.
                                A mechanical merge reported conflicts in ${JSON.stringify(suite.conflicts ?? [])} and ${suite.failed} failing test(s) (results at ${suite.results_ref}).
                                It also failed to account for these TestSet files, which it neither landed nor skipped: ${JSON.stringify(unaccounted)} — land any that are
                                missing from <worktree>/${TEST_DIR}/ (helper modules included, never overwriting a file already there) before re-running.
                                These skipped files were reported as already existing, but a task's fix loop actually repaired them during verification:
                                ${JSON.stringify(unlanded)} — they are NOT stale duplicates; land the repaired version of each (never blindly overwrite; compare
                                and carry forward whichever content is correct) before re-running.
                                Re-examine each conflicted file against the task branches' intents and make the integration branch carry ALL merged behaviors
                                correctly. Commit. Re-run the full suite of the app at <worktree>/${APP}/, write results to ${ART}/integration/${A.run_id}.json
                                and return the summary with artifact_ref = "integration/${A.run_id}" and conflicts = the files you changed.
                                Carry forward tests_landed ${JSON.stringify(suite.tests_landed ?? [])} and tests_skipped ${JSON.stringify(suite.tests_skipped ?? [])} unchanged
                                unless you changed which tests are present. Then run \`git rev-parse HEAD\` in that worktree and return its FULL
                                40-character sha as integration_commit — your commit, not the one the mechanical merge reported. Copy it exactly; omit it if the command fails.`,
    { label: 'integrate:resolve', model: MODEL.strong, ...AT('integrate-resolve'), schema: Suite })
  if (resolved) finalSuite = resolved
}
// AC-20: with nothing to integrate, finalSuite must say so — never a merged branch name, and never the generic
// INTEGRATION_FAILED fallback below (which is for an Integrator that ran and came back empty, a different case).
if (!passing.length) finalSuite = { artifact_ref: 'no task passed', passed: 0, failed: 0, results_ref: '', conflicts: [], tests_landed: [], tests_skipped: [] }

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
  // One entry per failing-test classification made across every task this run (wi-b6, AC-11): { test, criterion,
  // facts, class }. [] when nothing was ever classified — no round ever saw failed > 0, or every task was skipped.
  test_validity: finished.flatMap(f => f.testValidity ?? []),
  // One entry per owned-surfaces boundary repair attempt this run made (AC-13 of spec-wi-b5-sibling-value-repair).
  // [] when no task strayed.
  boundary_repairs: boundaryRepairs,
  escalations,
  starved_items: [],
  // Output tokens only, shared pool for the turn; the ledger append after the run carries the runtime's real figure.
  spend: { tokens: Math.max(0, budget.spent() - TOKENS_AT_START), wall_clock_min: 0, human_min: 0 },
  provenance: stamp('build-implement', 'n/a', 'hotl'),
}
