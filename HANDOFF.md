# HANDOFF — What to ask Claude Code, in order

You don't need to know graph engineering to drive this. You need to know three things: **the gate is where you show up**, **every workflow runs between two gates**, and **you test each phase on a toy before trusting it**.

The order is deliberate: Phases 0–6 build and prove one **production line** on a toy venture. Phases 7–10 build the **plant** around it (`COMPANY.md`) — and from Phase 7 on, the plant builds its own machines on that line. Don't build the plant first; a plant with no proven line has nothing to operate.

## 0. Setup (once)

```
mkdir company-graph && cd company-graph && git init
# copy in: CLAUDE.md, OPERATING_MODEL.md, HANDOFF.md, contracts.schema.json, .claude/workflows/
claude
```

Inside Claude Code:

```
/config                       → confirm Dynamic workflows is on; set size guideline to medium
/model                        → pick your session model (agents inherit it unless the script overrides)
/workflow-authoring           → loads the script-writing reference; run this in any session that touches workflows
```

Add the tools agents will need to your allow rules (git, your test runner, file writes under `.artifacts/`) so a long run doesn't stall on permission prompts.

## 1. The workflow map — where the gates are

Each row is one saved workflow. The gate column is where you act, in chat, between runs.

| Workflow | Runs the stretch | Gate that ends it | Your decision feeds |
|---|---|---|---|
| `/create-project` | Brief → Workspace + seeded backlog | none inside; **Brief approval** precedes it (`brief_approval` gate on the drafted Brief) | `/build-spec` |
| `/build-spec` | Plan → Spec → Route ∥ Decompose | **Spec Gate** (high-risk only) | `/build-implement` |
| `/build-implement` | Implement ∥ Test → Verify → Fix → Integrate → Evidence | **Escalations** (if any) | re-run for affected specs, or `/launch` |
| `/launch` | Preflight ∥ Release notes → Review package | **Launch approval** | `/deploy` |
| `/deploy` | Canary → Watch → Record | none (auto-rollback is code) | — |
| `/maintain-triage` | Signals → Triage → Route → Mitigate → Repro → RCA → Patch | **Sev1 page** (mitigation already applied) | `/build-reentry` |
| `/build-reentry` | Classify → Conflict detect → Budget split → Merge plan | **Ratio Gate** (on breach only) | `/build-spec` |
| `/improve-analyze` | Usage ∥ Feedback → Synthesize → Prioritize ∥ Verdict | **Roadmap Gate + Venture Verdict** | `/build-reentry` or close |
| `/memory-roll` | Pattern extract, calibrate, canary inject, Method Ledger | none | — |

Plant-level workflows (from `COMPANY.md`): `/scout`, `/thesis`, `/portfolio-review`, `/machine-registry`, `/plant-maintain`, `/process-eng`. Their gates: Portfolio Gate, Portfolio Review, Machine Release Gate, Risk & Security Review, Budget Allocation.

Five exist (`build-spec`, `build-implement`, `create-project`, `launch`, `deploy`). Claude Code writes the rest — production-line ones from `OPERATING_MODEL.md` §3–8, plant ones from `COMPANY.md` §2 — one per phase below.

## 2. Phases — paste these prompts

Each phase ends with a test you can run. Don't move on until it passes.

### Phase 0 — Substrate
```
Read CLAUDE.md, OPERATING_MODEL.md §0 and §9, and contracts.schema.json. Build the substrate under substrate/:
(1) an artifact store convention under .artifacts/ (diffs, tests, results, worktrees) with a tiny CLI to write/read by ref;
(2) a gate queue: gates/ directory where a workflow's output that needs a human decision is written as JSON with options, and a
    small script that lists open gates and records my decision;
(3) a run-trace and Method Ledger: every workflow return is appended to ledger/ with provenance, tokens, wall clock;
(4) a validator that checks any JSON against a named $def in contracts.schema.json.
Then create .claude/agents/ definitions for: implementer, test-author, lens-spec-conformance, lens-security, lens-correctness,
fixer, mechanical (cheap model, shell + fs only). Use the model tiering in CLAUDE.md.
```
**Exit test:** `validator EvidenceBundle some.json` accepts a valid file and rejects one with a missing field.

### Phase 1 — Build core, toy repo
```
Create a throwaway toy repo under toy/ (a small Express or Fastify API with 3 routes and a test suite). Seed toy/backlog.json
with 3 low-risk WorkItems (contracts.schema.json → WorkItem). Then run /build-spec with args
{ repo: "toy", workItems: <contents of backlog.json>, capacity: { tokens: 300000, iteration: 1 }, run_id: "r1", now: "<iso now>" }.
```
Review the output. Then:
```
Run /build-implement with args { repo: "toy", project_id: "toy", iteration: 1, specs: <the `ready` array from the last run>,
run_id: "r1", now: "<iso now>" }.
```
**Exit tests:**
- Zero human touches from spec to EvidenceBundle for 3 low-risk items.
- Inject a canary: `Edit toy/backlog.json to add a WorkItem whose spec will require an auth check, then run /build-spec and /build-implement; before verification, ask the implementer agent to deliberately omit the auth check.` The security lens must fail it.
- Force a repeat: `Re-run /build-implement with k_rounds: 1 on a spec you know will fail.` A valid `Escalation` must come back in the bundle.

### Phase 2 — Build breadth
```
Run /build-spec on 8 WorkItems, two of which touch the data schema (should route high). Confirm the low-risk 6 are in `ready`
and only 2 are in `gated`. I will approve the gated ones in chat; then run /build-implement on all 8.
```
**Exit test:** `/workflows` shows implementers and test authors running concurrently per task; only one Integrate phase.

### Phase 3 — Create + Launch
```
Using /workflow-authoring and OPERATING_MODEL.md §6 and §7, write and save /create-project, /launch, and /deploy.
/create-project takes a ProjectBrief as args and returns a Workspace. /launch takes an EvidenceBundle and returns a review
package for me. /deploy takes my approval and the bundle, deploys canary, watches N minutes against baseline, auto-rolls back
on regression, returns a LaunchRecord. Use the toy repo; deploy target can be a local port.
```
**Exit test:** Brief → running toy service with exactly two human actions (sign brief, approve launch). Seed a regression; deploy auto-rolls back.

### Phase 4 — Maintain
```
Write and save /maintain-triage from OPERATING_MODEL.md §4 and /build-reentry from §3. Feed it a synthetic Signal
(contracts.schema.json → Signal) for a sev2 bug in the toy repo, then a synthetic sev1.
```
**Exit test:** sev2 yields a verified Patch entering /build-reentry with no human touch; sev1 applies mitigation before the page appears in gates/.

### Phase 5 — Improve + Memory
```
Write and save /improve-analyze from §5 and /memory-roll from §8. Feed /improve-analyze synthetic telemetry and three
feedback items against the toy ProjectBrief.
```
**Exit test:** a ranked Opportunity list and a VentureVerdict land in gates/; the Method Ledger reports tokens and outcomes grouped by `provenance.method`.

### Phase 6 — First venture
Write a one-paragraph idea. Then:
```
Turn this idea into a ProjectBrief (contracts.schema.json) with success metrics and kill criteria I can actually measure.
Then run the full loop: /create-project → /build-spec → [my gate] → /build-implement → /launch → [my gate] → /deploy.
```
**Exit test:** the venture is live, one Improve cycle has run, and you have a VentureVerdict you'd defend.

### Phase 7 — Venture 0: the plant on its own line
```
Read COMPANY.md §5. Write venture 0's ProjectBrief for this repo (success metrics and kill criteria from §5). Convert the
remaining phases of HANDOFF.md into WorkItems with source=tooling in backlog/venture0.json. From now on, every new workflow,
agent, lens, or contract is built by running /build-spec and /build-implement on this repo against that backlog.
Add the machine lenses from COMPANY.md §2.2 (contract_compat, replayable, cost_profile, safety_tier) to build-implement's
Verifier Panel when a WorkItem has source=tooling.
```
**Exit test:** one new workflow (pick `/create-project` if it doesn't exist yet) is produced by the plant's own line, passes the machine lenses, and lands in `.claude/workflows/` via a Machine Release decision you make in chat.

### Phase 8 — Plant Maintenance + Registry
```
From COMPANY.md §2.2 and §2.3, write and save /machine-registry (publishes a released machine with version, contracts, method
tier, cost profile) and /plant-maintain (trace collector, drift detector, canary runner, vendor watch, machine triage → tooling
intake). Run /plant-maintain against the traces from Phases 1–7.
```
**Exit test:** a deliberately regressed lens prompt is caught by the canary runner and appears as a MachineSignal in the tooling backlog.

### Phase 9 — Process Engineering + Governance
```
From COMPANY.md §2.4 and §2.6, write and save /process-eng (ledger analyst ∥ bottleneck analyst → tier recommender → change
proposal) and the governance substrate: policy registry (which node kinds may run dark_factory, spend ceilings, always-human
list), HOTL audit sampler at a rate I set, budget allocation proposal.
```
**Exit test:** `/process-eng` produces at least one TierProposal with evidence from the ledger (e.g. "Spec Gate has approved 100% of N batches — propose HOTL with audit sampling"), and it lands in gates/ for your decision rather than being applied.

### Phase 10 — Strategy + Operations, then venture 1
```
From COMPANY.md §2.1 and §2.5, write and save /scout (opportunity memos from a thesis I give it), /thesis (memo → VentureThesis),
/portfolio-review (all VentureVerdicts + P&L → recommendations), and the ops substrate: cost ledger and P&L per venture.
Leave money movement, signatures, and credentials as Direct Driver checklists in gates/ — never automate them.
```
**Exit test:** you give it a one-line thesis; a VentureThesis reaches the Portfolio Gate; you approve; venture 1 runs Phases 3–5's loop on its own repo with the plant's machines; its first VentureVerdict and P&L appear in a Portfolio Review.

## 3. Habits that keep it honest

- **Small slice first.** Every new workflow runs on one item before ten. `/workflows` shows tokens per agent; stop anything that surprises you.
- **Read the script once.** Press `View raw script` on a run. If you see two agents chained with no variable passing between them, that's a false edge — tell Claude.
- **Gate discipline.** When something lands in `gates/`, decide it there. Don't reach into a running workflow.
- **Ledger before opinion.** After Phase 6, ask: `Summarize the Method Ledger: for each working method, tokens spent, human minutes, and defects found downstream.` That answer is what your five-row table was for.

## 4. Known runtime facts that shaped this

- Workflows can't pause for a human → gates are workflow boundaries.
- Scripts can't import, touch disk, or shell → contracts are inlined; mechanical steps are cheap agents.
- `Date.now()`/`Math.random()` throw → pass `run_id` and `now` in `args`.
- 16 concurrent agents, 1,000 per run, 4,096 items per `parallel()`/`pipeline()` call.
- Stopping one agent in a fan-out reruns everything started after it on relaunch — prefer letting a run finish.

## 5. Phase status

| phase | state | evidence |
|---|---|---|
| 0 Substrate | passed | `substrate/validator.js` accepts a valid EvidenceBundle and rejects a short one |
| 1 Build core | passed | runs `r1`–`r8` |
| 2 Build breadth | passed | run `t1i` onward: implementers and test authors concurrent per task, one Integrate phase |
| 3 Create + Launch | passed **with a caveat** — see C3 below | `c1` brief → `c1v` launch → `c1d` auto-rollback on a seeded regression |
| 4 Maintain | **passed** | see below |
| 5 Improve + Memory | passed | `i1` ranked Opportunity[] + VentureVerdict in `gates/closed/i1-roadmap_gate.json`; `mr1`/`mr2` Method Ledger by `provenance.method` |
| 6–10 | not started | |

### Phase 4 exit test, both halves

`sev2 yields a verified Patch entering /build-reentry with no human touch`
: `ledger/runs/m1b-maintain-triage.json` — triage sev2, `patch-sig-p4-1` sev2/routine, `repro.status: "reproduced"`, no gate emitted. `b1` consumed it into 3 WorkItems. `human_min = 0` on both ledger rows.

`sev1 applies mitigation before the page appears in gates/`
: `ledger/runs/m2-maintain-triage.json` — `mitigation.applied: true`, `strategy: "rollback"`, `applied_at: 03:36:00Z`, prod `243b72a2 → bfb99434`; `incident.status: "mitigated"`; then `gates/closed/m2-sev1_page.json`. Mitigation precedes the page.

Two supporting results, both negative and both correct:

- **`m1` is the honest negative.** No live deploy target, so `strategy: "none"`, `applied: false`, `status: "unmitigated"`. The mitigator refused to report a rollback it could not perform.
- **`b2r` refused a decision passed in args.** `"1 sev1 patch(es) and no gate_id: the sev1 page decides whether the mitigation is still holding, and it is read from gates/, not from args"` — the same guard as the Spec Gate (`.claude/workflows/build-implement.js:456`), in a second place.

---

## 6. Carried — open items, with references

Each item says where it lives so it can be picked up cold. Nothing here blocks Phase 4; several block Phase 8 or a second venture.

### A. The build line's own defects (venture 0)

**A1 — The lens-worktree fix is prompt-only, and prompt guidance has been measured insufficient here.**
`.claude/workflows/build-implement.js:685-689`, plus the three `.claude/agents/lens-*.md`. Run `t7i` escalated `repeat_finding` on nine findings that were every one of them true of the base commit and false of the change under review: the lens prompt was the only verify-loop prompt that never named the worktree, so a lens that opened a file greped the repo root at the pre-task commit. The script cannot set a subagent's working directory, so no code-side enforcement exists — unlike the boundary check, which is real code.
*Proposed:* in script, compare each finding's cited `path:line` against the diff hunks and drop citations that do not intersect. Zero tokens, rule 3 compliant, and it catches the failure rather than asking politely.

**A2 — The venture-0 bootstrap: a build-line fix is always one run late.**
`/build-implement` executes the committed copy of itself, so `t1`'s AC-16 TEST-ONLY re-route — written for exactly the three findings that deadlocked `t1` — could not engage in the run that produced them.
*Investigate:* load the fix-loop decision block from the worktree under review rather than from the running script. `substrate/test/extract-fixloop.js` already extracts it between the `// ---- BEGIN/END fix-loop decisions ----` sentinels, so the machinery exists.

**A3 — The owned-surfaces boundary is enforced but has never run.**
`.claude/workflows/build-implement.js`: `surfaceRef:292`, `withinOwned:305`, `boundaryCheck:326`, `criteriaScope:351`, `stripForeignFindings:400`, `routeFinding:424`, `fixOutcome:436`. Call sites: `:622` (settled ChangeSet, before any lens/test-runner/fixer) and `:921` (each round's merged ChangeSet); scoping at `:714`. Run `t7i` executed the pre-merge copy, so the next build is the first real exercise. Watch it deliberately.

**A4 — Escalation rate and the hitl/hotl question.**
10 escalations across 31 `hotl` runs, carrying most of the spend. Open design question: should some escalation reasons be `hotl` (proceed, land in the review queue) rather than `hitl` (stop the world)? `repeat_finding` on findings a fixer provably cannot close is the candidate.

### B. Missing edges

**B1 — Memory → Build does not exist.** `grep -n "memory\|pattern\|prompt_refinement" .claude/workflows/build-spec.js` returns nothing. `/memory-roll` produces patterns and canaries (`ledger/runs/mr2-memory-roll.json` → `roll.patterns` ×10, `roll.canaries` ×10) and nothing consumes any of it. This is the edge that would catch a bad decomposition without a human in the loop.

**B2 — The canary library is not wired.** `.claude/workflows/build-implement.js:599` reads `A.canary` from `args` only; a human hand-picks one. Phase 8's exit test needs the runner to pull from `roll.canaries`.

**B3 — Graph lint belongs in code, not in the decomposer prompt.** `.claude/workflows/build-spec.js:87-93` states the rules and validates none of them. `t7`'s decomposition still shipped a false edge *and* assigned AC-12 to a task that did not own the file it names. Two checks, zero tokens: every criterion's required surface ∈ its task's `owned_surfaces`; every `depends_on` justified by a variable actually crossing.

### C. Durability and substrate

**C1 — `WorkItem.branch` and `patch_ref` name local branches in an ephemeral container.** Dead on the next session. Open question: should `/maintain-triage` push `WorkItem.branch`? `patch_ref` has the identical defect.

**C2 — `run-output.js --save` collides with `ledger append --from-output`.** Both target `ledger/runs/<id>.json`; `substrate/ledger.js:131` then refuses with `"ledger already has <id>; a re-run needs a new run_id"`. `--from-output` writes the result itself, so `--save` is only for the older `--started/--result` path. Documented order is wrong.

**C3 — Phase 3's promoted commit is unrecoverable.** `git cat-file -t 44df6d7adf44108db3062bc590ee4cc7677a68b7` → *could not get object info*. That sha is `live_sha` and `prod.sha` in both `c1v-deploy` and `c1d-deploy`, and `?offset` — the brief's entire `initial_scope` — is in no commit on `main`. Covered by `opp-p5-1`.

**C5 — Nothing delivers a gate to a human. A page is written to disk and no one is told.**
The model already assumes a delivery channel and none exists:
- `OPERATING_MODEL.md:249` — the Incident Commander's outputs are *"incident record, **page HE**"* with tooling *"comms, status page"*. That tooling was never built.
- `OPERATING_MODEL.md:326` — `/create-project`'s Comms Setup is supposed to produce *"client channel, status page, review queue"* from *"comms APIs"*. Venture 0 never ran it.
- `OPERATING_MODEL.md:15` and `CLAUDE.md:24` both define Dark Factory as *"no notification unless budget breached"* — the exception presumes a notifier for the breach case.
- `OPERATING_MODEL.md:391` — Phase 4's own row reads *"sev1 rolls back before the page **fires**"*. It never fires. `substrate/gates.js` contains no notification code of any kind: `grep -n "notif\|alert\|webhook\|slack\|email" substrate/gates.js` returns nothing. `gates open` writes a JSON file and exits.

**Measured cost of the gap:** run `m1` emitted a **sev1** page at `2026-09-11T03:04:00Z`. It was opened at `2026-09-11T21:57:06Z` — **18h53m later**, and only because a human asked for a Phase 4 audit. Nothing about the intervening silence distinguished "no sev1" from "an unmitigated sev1 nobody has been told about". Every gate in `COMPANY.md:182` has the same property: Spec Gate, Launch approval, Roadmap Gate, Ratio Gate, Machine Release, fix-loop escalations.

*What is and is not wanted:* the current behaviour — the page fires as a durable, adjudicable record — is correct and stays. What is missing is a **delivery method that reaches a human where they actually are**, phone included, so a sev1 does not wait on someone happening to look. Design notes for whoever picks this up:
- Delivery belongs beside `gates.js open`, not inside a workflow: a workflow cannot pause for a person, and the gate record is already the single place every page passes through.
- It must be **best-effort and non-blocking**. A failed notification must never fail the gate or the run; the record on disk stays the source of truth and the notification is a pointer to it.
- Severity should route: a sev1 page and a budget breach reach a phone; a Spec Gate can reach a queue.
- Configuration belongs in `/create-project`'s Comms Setup (`OPERATING_MODEL.md:326`) so a venture gets a channel at creation rather than by hand.
- Whatever the transport, the gate record should record that delivery was attempted and whether it succeeded, so an unopened page is distinguishable from an undelivered one — which is exactly what could not be told apart for `m1`.

**C4 — This repository has no CI.** No `.github/workflows/`. `/create-project` §6 is supposed to stand CI up, and venture 0 never had it, so nothing runs the suites on a push.

### D. Measurement gaps

**D1 — The Lens Calibrator has no honest sample.** `ledger/runs/mr2-memory-roll.json` → `roll.lens_catch_rates`: `catch_rate: null`, `unavailable_reason: "no escaped-defect denominator exists"`. 30 panels, 39 findings raised, 39 upheld, 0 attributable escapes. **Phase 4's planted defects are not lens misses and must never be counted as any.** Covered by `opp-p5-7`.

**D2 — The line's own human-action count is wrong.** Escalation gates are dropped, so a path costing three human decisions reports as two. Covered by `opp-p5-6`.

**D3 — The Ratio Gate has never fired.** `.claude/workflows/build-reentry.js:238-255` opens it only on a *second consecutive* breach, and `A.ratio.history` was never supplied. §3's only gate is unexercised.

### E. Approved at the Roadmap Gate, still unbuilt

`gates/closed/i1-roadmap_gate.json` → `decision.selection` carries all 8. Shipped: `opp-p5-5` (`ledger append --from-output`), `opp-p5-3` (`X-Total-Count`), `opp-p5-4` (re-panel scoping, as `wi-imp-1`; effect not re-measured). Remaining, in rank order:

| rank | id | one line |
|---|---|---|
| 1 | `opp-p5-2` | the canary watch probes five hard-coded request shapes that exclude `?q`, so a regression confined to it is invisible |
| 3 | `opp-p5-1` | nothing reconciles what `/deploy` promoted back into `main` (see C3) |
| 4 | `opp-p5-6` | count every gate as a human action (see D2) |
| 7 | `opp-p5-7` | a lens/router calibration number that would move if they were wrong (see D1) |
| 8 | `opp-p5-8` | required env config unchecked in `create-project`/`launch`/`deploy` — a documented route was dead for a window with no `ADMIN_TOKEN` |

All 8 came back `within_budget: false`, and 7 of 8 change the plant rather than the toy.
