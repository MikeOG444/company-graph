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
| `/create-project` | Brief → Workspace + seeded backlog | none (Dark Factory) | — |
| `/build-spec` | Plan → Spec → Route ∥ Decompose | **Spec Gate** (high-risk only) | `/build-implement` |
| `/build-implement` | Implement ∥ Test → Verify → Fix → Integrate → Evidence | **Escalations** (if any) | re-run for affected specs, or `/launch` |
| `/launch` | Preflight ∥ Release notes → Review package | **Launch approval** | `/deploy` |
| `/deploy` | Canary → Watch → Record | none (auto-rollback is code) | — |
| `/maintain-triage` | Signals → Triage → Route → Mitigate → Repro → RCA → Patch | **Sev1 page** (mitigation already applied) | `/build-reentry` |
| `/build-reentry` | Classify → Conflict detect → Budget split → Merge plan | **Ratio Gate** (on breach only) | `/build-spec` |
| `/improve-analyze` | Usage ∥ Feedback → Synthesize → Prioritize ∥ Verdict | **Roadmap Gate + Venture Verdict** | `/build-reentry` or close |
| `/memory-roll` | Pattern extract, calibrate, canary inject, Method Ledger | none | — |

Plant-level workflows (from `COMPANY.md`): `/scout`, `/thesis`, `/portfolio-review`, `/machine-registry`, `/plant-maintain`, `/process-eng`. Their gates: Portfolio Gate, Portfolio Review, Machine Release Gate, Risk & Security Review, Budget Allocation.

Two exist (`build-spec`, `build-implement`). Claude Code writes the rest — production-line ones from `OPERATING_MODEL.md` §3–8, plant ones from `COMPANY.md` §2 — one per phase below.

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
