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

### Current order of work

`C8 → A7 → B3 (absorbing A6) → A5 → C5 → A1 → B1+B2 → C10`. **Confirmed next, after A5 landed: `B5 → C5 → B1+B2 → C10`** (B5 first because it is a defect in the machine
that builds everything after it; spec draft carries options 1 + 2 + 3). **B5 landed at `k9d`** (see B5). **Next: B6, then C5 → B1+B2 → C10**
— B6 moved to the front because `k9b` spent a full run failing correct work on invalid tests, which will recur on
every build until it is fixed.

**Operating rule (set by the human after `k9b`).** Option menus and escalation choices are evaluated and decided by
the main session, not handed to the human. The decision is still recorded exactly as before: the gate is closed with
the reasoning, the ledger row carries the method (`direct_driver` when the main session drives), and HANDOFF names
what the line could not do. The human is asked only for: spend beyond roughly twice a WorkItem's budget, anything
irreversible or outward-facing (merge, delete, publish), a change of strategy or order of work, or a pricing figure
that cannot be looked up. A clean lint or a green panel is still not consent, and a human gate a workflow requires
(Spec Gate on high risk) is still opened — the rule changes who picks among options, not what is recorded. `backlog/venture0.json` carries all of them as
WorkItems. **C4, C8, A7 and B3 are landed** (PR #9, branch `claude/company-graph-carry-list-e2z510`); B3 moved ahead
of A5 mid-flight for the reason recorded under B3 below, and A5 is in progress — specced twice (`k4`, `k6`),
decomposed by hand at `k6h` after four agent decompositions failed the lint, and **landed at `k7d` by direct drive**
after `/build-implement` run `k7` escalated both tasks (see A5 and the new B5).

C8 leads because CI is red until it lands, and a red baseline makes "did my change break CI?" unanswerable for every
item after it. A7, A5 and A6 then come before the originally-planned work because **they are defects in the machine
that builds the rest**, and every run made with them open produces evidence contaminated by known wiring bugs — A7
most of all, since a green panel currently is not evidence that `target: "test"` findings were addressed.

**Tier vs wiring, decided from one session's measured evidence.** The question was raised as "maybe haiku is not the
right model for some tasks". The run data says otherwise, and the distinction matters because tier is the expensive
lever:

| node | model | what it actually did on `k1`–`k1v` |
|---|---|---|
| planner | haiku | implemented and committed the work item instead of returning ids |
| risk router | haiku | correct — routed low with sound reasons |
| decomposer | haiku | correct — clean single-task graph, no false edge |
| lenses ×3 | haiku | found **every** real defect: three in `k1i`, plus the AC-9 instance a human missed in `k1v` |
| correctness lens | haiku | returned `verdict: "pass"` while reporting two findings |
| lenses, `k1v` r2 | haiku | did not re-raise a still-present defect → the false pass in A7 |
| implementer | sonnet | good artifact, but seeded three instances of one regex defect |
| test author / testfix | sonnet | disputed instead of fixing — **correctly**; it was pointed at the wrong file |
| spec writer | opus | strong; caught that the work item's own test count was stale |
| escalation packager | opus | strong; verified the suite, spotted the duplicated finding, scoped the fix to two lines |

The planner failure was a **tools** failure, not a judgment failure: that call site named no `agentType`, so it
inherited `Bash`/`Write`/`Edit`. Any tier handed an instruction-shaped `intent` and a `Write` tool could have done
it. The cheap lenses were the best-performing part of the line — they found a defect class a human missed while
deliberately fixing that very class. Of the six failures observed, five are structural (A5, A6, A7) and survive any
tier change; the sixth, `pass` alongside findings, is already contained by the script deriving verdicts from
findings rather than trusting the agent's own word, which is the rule working as designed.

So: **fix the wiring, then re-read the ledger.** A7's fix in particular removes the dependency on a cheap lens
re-raising anything, which is the one weakness tier would plausibly have addressed. Revisit tier with ledger
evidence after A5/A6/A7 land, not before — and note the largest single token line available to cut is the lenses
(394k haiku tokens on `k1v` alone), so raising *them* is the most expensive move on the board and wants evidence
first.

### A. The build line's own defects (venture 0)

**A1 — The lens-worktree fix is prompt-only, and prompt guidance has been measured insufficient here.**
`.claude/workflows/build-implement.js:685-689`, plus the three `.claude/agents/lens-*.md`. Run `t7i` escalated `repeat_finding` on nine findings that were every one of them true of the base commit and false of the change under review: the lens prompt was the only verify-loop prompt that never named the worktree, so a lens that opened a file greped the repo root at the pre-task commit. The script cannot set a subagent's working directory, so no code-side enforcement exists — unlike the boundary check, which is real code.
*Proposed:* in script, compare each finding's cited `path:line` against the diff hunks and drop citations that do not intersect. Zero tokens, rule 3 compliant, and it catches the failure rather than asking politely.

**A2 — The venture-0 bootstrap: a build-line fix is always one run late.**
`/build-implement` executes the committed copy of itself, so `t1`'s AC-16 TEST-ONLY re-route — written for exactly the three findings that deadlocked `t1` — could not engage in the run that produced them.
*Investigate:* load the fix-loop decision block from the worktree under review rather than from the running script. `substrate/test/extract-fixloop.js` already extracts it between the `// ---- BEGIN/END fix-loop decisions ----` sentinels, so the machinery exists.

**A3 — The owned-surfaces boundary is enforced but has never run.**
`.claude/workflows/build-implement.js`: `surfaceRef:292`, `withinOwned:305`, `boundaryCheck:326`, `criteriaScope:351`, `stripForeignFindings:400`, `routeFinding:424`, `fixOutcome:436`. Call sites: `:622` (settled ChangeSet, before any lens/test-runner/fixer) and `:921` (each round's merged ChangeSet); scoping at `:714`. Run `t7i` executed the pre-merge copy, so the next build is the first real exercise. Watch it deliberately.

*Executed at last on run `k1i`, and stayed silent — correctly, but this does not close A3.* `spec-wi-c4-ci`
decomposed to a **single** task owning both its surfaces, so `boundaryCheck` had no sibling to compare against:
`strays` and `unowned` were both empty and the interesting branches never ran. What `k1i` proves is only that the
check executes without throwing on the merged copy. `criteriaScope` is equally untested here — one task owned all
fifteen criteria, so `sibling_owner` was empty and `stripForeignFindings` dropped nothing. **The real exercise needs
a spec that decomposes to two or more tasks**, which none of the remaining carry items is guaranteed to produce.
Keep A3 open until a multi-task spec runs, and prefer one deliberately.

*A deliberate one now exists and has not yet run.* `k6h`'s graph is two tasks with disjoint surfaces and no edge
between them — `.claude/agents/` against the nine workflow `.js` files — so the next `/build-implement` is the first
run where `boundaryCheck` has a sibling to compare against and `stripForeignFindings` has foreign findings to strip.
Watch `strays`, `unowned` and `sibling_owner` deliberately; if they are empty again, A3 stays open and the reason
will be worth recording.

*First live sibling on `k7`, and the check was right.* `t2-workflow-bindings` wrote twelve files into
`.claude/agents/`, which `t1-agent-definitions` owns. `boundaryCheck` reported **12 strays, all attributed to
`sibling_owner: t1-agent-definitions`, 0 unowned** — every one correct, none spurious. **Detection is now proven;
repair is not.** The run's only response was an escalation, and a human resolved it (`k7-escalation`, `direct_drive`).
`stripForeignFindings` still has not run with a foreign finding to strip: `t2` escalated at the boundary before any
lens saw it. Close A3 as *detection verified*; the missing repair is carried as B5.

**A4 — Escalation rate and the hitl/hotl question.**
10 escalations across 31 `hotl` runs, carrying most of the spend. Open design question: should some escalation reasons be `hotl` (proceed, land in the review queue) rather than `hitl` (stop the world)? `repeat_finding` on findings a fixer provably cannot close is the candidate.

*Run `k1i` is the first evidence that a `budget` escalation earns its keep, and a second candidate for `hotl`.*
Round 1 spent 71,345 tokens against a 40,000 round cap and escalated **before** `max_rounds`, exactly as designed.
The escalation it wrote was not a shrug: it re-ran the landed suite (15/15), read the shipped artifact, established
that the shipped `ci.yml` carries no `working-directory:` key so every line the findings touch is an unreachable
fallback, noticed that two of the three findings were **one defect reported by two lenses under different
`dedupe_keys`**, and scoped the remaining work to two lines. A human then verified all four claims and found them
correct. That is the machinery working — but the whole run cost $1.30 and a human decision to resolve two lines in
dead code, in a change whose suite was already green. The `hotl` case here is stronger than for `repeat_finding`:
when every open finding is `target: test`, the suite passes, and the escalation itself can show the findings are
unreachable against the artifact, proceeding into the review queue loses nothing a human gate is buying.
**Counter-evidence to weigh first:** the findings were real defects, and merging on a green suite is how latent
bugs in fallback branches ship. The question is whether the review queue actually gets read — which is C5.

**A5 — A workflow agent with no `agentType` can do the work instead of describing it, and nothing in the run says so.**
Found on run `k1`, the first `/build-spec` of the carry-list work, against work item `wi-c4-ci`.

The Iteration Planner's whole contract was to return the ids it selected: *"Select work items to ship this iteration
within N tokens… Return the selected ids only."* Its call site named no `agentType`, so it resolved to the default
`workflow-subagent` and carried **Bash, Write and Edit**. A `WorkItem.intent` reads like an instruction. The cheap model
did the obvious wrong thing — `mkdir -p .github/workflows`, wrote `ci.yml`, ran `npm ci` and both suites, then
`git add .github && git commit` — and returned a correct, schema-valid `{"ids":["wi-c4-ci"]}` as if it had only chosen.

Three properties make this worse than a stray write:

- **It bypassed the entire line.** No Spec, no TestSet, no Verifier Panel, no owned-surfaces boundary check. C4 would
  have "shipped" verified by nothing, which is the exact opposite of building it on the line.
- **It was silent.** The return value satisfied its schema and named the right item. Nothing in the workflow output,
  the phase log or the result disclosed a filesystem write or a commit. It was caught by a `git` stop-hook noticing an
  unpushed commit — that is, by luck, from outside the graph.
- **It generalises.** The planner runs on every `/build-spec`, and every WorkItem's `intent` is prose that can be read
  as an instruction. It also had a second victim queued: the spec writer had already run `git show --stat 68606e7` and
  would have specced against work that already existed, so the implementer would have found nothing to do and
  deadlocked on an empty diff — the `t5i`/`t2` failure mode A3 already describes.

*Fixed in part, by hand (`direct_driver`), because the line cannot build the fix that unblocks the line:* the planner is
deleted. Selecting items within a token budget is a sort and a take, so it is now script code between
`// ---- BEGIN/END plan-selection ----` in `.claude/workflows/build-spec.js`, with `substrate/test/plan-selection.test.js`
pinning the ordering, the capacity edges, and the two regressions (no `planner` label may reappear; the surviving agents
are enumerated). Zero tokens, deterministic, replayable — none of which the agent was.

*Still open, and the sixth carry item (`wi-a5-agent-least-privilege`):* the same hole is open on every other unbound
call site. In `build-spec.js` the spec writer and the risk router both run as `workflow-subagent`; the spec writer
legitimately needs to read code, so binding it is a real design decision (a read-only type loses it `Bash`, which it
currently uses for `cat`/`sed`/`npm test`), not a one-line change. `build-implement.js` binds its lenses and mechanical
agents with `AT(...)` and is in better shape, but has not been audited. The rule worth landing: **a node that produces
judgment never holds a tool that produces a commit**, enforced at the call site rather than in a prompt.

*Related, and now measured rather than assumed:* subagents are not constrained by the session's auto-mode classifier.
It refused this session's own attempts to widen `.claude/settings.json` (`[Self-Modification]`) and to `git reset --hard`
(`[Irreversible Local Destruction]`), while a Haiku subagent wrote `.github/` and committed without challenge. The
allow-list in `.claude/settings.json` is therefore not the control surface for agent writes; `agentType` is.

*Specced twice, and the count is 15, not 14.* `k4` and `k6` each produced a Spec for this item. Both are sound and
they disagree only in scope: `k6` enumerates **15** unbound call sites, verified independently by scanning the nine
workflows for an `agent()` options object naming no `agentType` and no `AT(...)`/`NEW(...)` spread — build-implement 6
(three `escalate`, `tiebreak`, `dispute`, `integrate:resolve`), build-spec 3 (`spec`, `route`, `decompose`),
build-reentry 2 (`classify`, `surfaces`), create-project 2 (`stack`, `seed`), launch 1 (`notes`), maintain-triage 1
(`incident`); `deploy.js`, `improve-analyze.js` and `memory-roll.js` are already fully bound. `k6` also decides two
sites explicitly against reflex rather than by rule: the spec writer becomes read-only at the strong tier, and
`integrate:resolve` keeps write permission through its own strong-tier definition, because binding it to the existing
haiku-tier `mechanical` type would silently re-tier a node.

*Spec-writer variance is real and it runs both ways.* Same model, same tier, same work item: `k6`'s spec is **better**
on the audit (15 sites against `k4`'s 14) and **worse** on the A6 trap. `k4` kept `substrate/test/` out of
`touched_surfaces` and said why in `out_of_scope`, citing A6 by name. `k6` named
`substrate/test/agent-binding.test.js` and its helper, and the decomposer duly built a test-only task from them.
The WorkItem's own `surfaces` list includes `substrate/test/`, so the trap is in the input. Lint check 5 caught it.
The practical lesson for picking up this work cold: *"the preserved spec is good"* is not a property that survives a
re-run, so re-read a fresh spec against the traps rather than assuming the line has learned them.

*Ready for `/build-implement` as of `k6h`.* The Spec Gate `k6-spec_gate` was decided `revise`; the Spec was then
corrected by hand (`direct_driver`) to drop the two test surfaces and restate test authorship in `out_of_scope` in
`k4`'s form, which left its `touched_surfaces` byte-identical to `k4`'s ten. Four decompositions of that corrected
Spec failed the lint (see the table under B3), so the graph is hand-authored and lint-clean: `t1-agent-definitions`
owns `.claude/agents/` with AC-2, AC-3 and AC-10; `t2-workflow-bindings` owns all nine workflow `.js` files with the
other ten criteria; no edge joins them, so they run in parallel. The durable copy is
`ledger/runs/k6h-build-spec-direct.json` — **not** the gate payload's `spec_ref`/`graph_ref`, which point into
`.artifacts/` and are dead on the next container (the C1 class, in a second place).

*Landed at `k7d` (commit `c88074a`), by direct drive, on purpose.* `/build-implement` run `k7` escalated both tasks.
`t2` needed agentType names that only `t1` was creating, in parallel, in another worktree; it invented its own twelve
(`spec-writer`, `risk-router`, `integrator`, …) and wrote their definitions itself, while `t1` named its twelve after
the call-site labels (`spec`, `route`, `integrate-resolve`, …). The patches disagreed on every name. `t1`'s panel,
meanwhile, failed on a TestSet defect, not a code defect: its helper resolved `REPO` three levels above
`.artifacts/tests/<task>/` — the main checkout, never the task worktree — **the same class `t7d` fixed in the lens
prompt**, now recurring in a Test Author's helper. Round 1 spent 170,609 tokens against an 83,333 round ceiling on it.

The human chose `direct_drive` over `kill_to_spec` *deliberately*: pre-naming the twelve strings in the Spec would
have made this run pass and hidden the defect, and the value that needs naming is, in general, not knowable when the
Spec is written. So the intervention stays on the record as the thing to engineer away (B5). Driven by hand: `t1`'s
definitions kept (the owner's), `t2`'s strays discarded and its bindings rebound; the Test Author's 42 tests landed as
`substrate/test/a5-*.test.js` with three test fixes (REPO depth; AC-6 compared a label with its closing quote
attached; the scanner did not count a computed `` AT(`lens-${...}`) `` as a binding). Verified: 15 unbound sites → 0;
labels, tiers, schemas and `pipeline/parallel/phase` counts identical in all nine files; original prompt sentences
intact; two planted mutations (unbind `route`; give `spec.md` Bash) turned 5 and 6 tests red; root 216/216, toy 60/60.
Not re-panelled. **Bootstrap:** `build-spec.js` and `build-implement.js` change here, so the bindings first engage on
the next run of each; the tests above are source-text tests for exactly that reason.

*The hand graph was the defect, and it was lint-clean.* `k6h` split one coupled value across two tasks with no edge,
and all five lint checks passed it: a zero-violation graph is not a sound one. The decomposer rule *"prefer ONE task"*
would have avoided it, and a human broke that rule too. `k7` cost $1.38 priced (sonnet $1.10, haiku $0.28) plus
165,231 opus-5-5 tokens that `substrate/lib/pricing.json` has no rate for.

**A6 — A spec can hand the Test Author's job to the implementer, and the TestSet then dies in `.artifacts/`.**
Found on run `k1i`. `spec-wi-c4-ci` listed `substrate/test/ci-workflow.test.js` in `touched_surfaces`, the decomposer
duly put it in the single task's `owned_surfaces`, and the **implementer** wrote it — 289 lines, 15/15 passing, on
`task/t1-ci-workflow`. The **Test Author** ran in parallel as designed and produced its own TestSet at
`.artifacts/tests/t1-ci-workflow/` covering AC-1…AC-13. The bundle came back `tests_landed: []`. Two agents were
pointed at one job; the one the design intends produced the artifact that does not survive the container, and the
one that shipped was never meant to write tests at all.

The decomposer prompt (`build-spec.js:87-93`) forbids *a task whose only job is writing tests* and says a separate
Test Author writes them from the spec. It does not forbid a spec from naming a test file as a touched surface, and
`t1-ci-workflow` was not a test-only task, so nothing in the graph objected. The gap is upstream of the decomposer:
the **spec writer** chose the verification strategy and named the file.

*Consequence beyond the duplication:* the implementer writes tests **against its own implementation**, which is
precisely the independence the Test Author exists to preserve. `.claude/agents/test-author.md` says tests come from
the Spec alone, never from the implementation. On `k1i` that guarantee was quietly void — and the tests it produced
are the ones that would have shipped.

*Proposed:* in `build-spec`, treat a surface under the repo's `test_dir` appearing in `Spec.touched_surfaces` as a
decomposition error, the same class of check as B3 — zero tokens, script code. Either the spec must not name test
files, or the Test Author must own them; the two cannot both be true. Fold into B3's graph lint rather than
carrying separately.

*Second half, from `k1v`:* **the TestSet's landed files are never boundary-checked at all.** `boundaryCheck` is
called on the implementer's `ChangeSet.touched_surfaces` only (`:622`, `:921`). On `k1v` the Test Author produced
`substrate/test/repo-root.js` — a third file, outside `Spec.touched_surfaces` and outside the task's
`owned_surfaces` — and integration landed it without a murmur. It happens to be a good helper (it walks up to find
the repository root instead of hardcoding `'..', '..'`, which is the C1 fragility), and it was dropped from the C4
merge only because a human read the integration diff. Nothing in the graph would have objected to anything it
contained. A6's check must therefore cover both directions: what the spec may name, and what the TestSet may land.

**A7 — A `target: "test"` finding can be disputed away with no ruling, and the panel then passes the unfixed change.**
Found on run `k1v`, and it is the most serious defect this session produced, because it is a **pass-by-default path**
in the one component whose entire job is to refuse.

What happened, in order:
1. Round 1 raised `AC-9 test uses form-specific regex` at `substrate/test/ci-workflow.test.js:190` — **severity high**,
   independently reported by two lenses (`spec_conformance` and `correctness`), both `target: "test"`.
2. Two `testfix` agents ran. **Both disputed.** One: *"DISPUTE: the finding's evidence (line 190…)"*. The other:
   *"DISPUTE: The finding is real but does not apply to the file I'm responsible for."*
3. **No judge ruled.** Round 2 re-panelled, both lenses returned `pass`, the change was integrated, and
   `escalations: 0`.
4. Line 190 was **never touched**. The task branch's test file was byte-identical before and after. The defect
   shipped in a change the panel had just called clean.

The mechanism is two lines of filtering. At `.claude/workflows/build-implement.js:832-834`:
```js
const disputed     = fixes.filter(x => x.kind === 'code' && fixOutcome(x.p.notes) === 'dispute')
const testRepairs  = fixes.filter(x => x.kind === 'test' && !x.p.notes?.startsWith('DISPUTE:'))
```
A disputing **test** repair matches neither. It never reaches the dispute judge at `:872` (which requires
`kind === 'code'`), and it never sets `resolution[dedupe_key]`, so the catch-all marks it `unresolved` — and an
unresolved finding survives only as long as a lens keeps re-raising it. When the lens does not, it is gone. A code
Fixer's dispute is always ruled on by a judge; a Test Author's dispute is ruled on by nobody. `Escalation.disputes_lost`
is fed from `ctx.upheld`, which only the judge writes, so a test dispute cannot even appear in an escalation.

*Contributing cause, and a defect in its own right:* the test-repair agent is pointed at `ctx.testSet.tests_ref` —
`.artifacts/tests/t1-ci-workflow/`, a **copy** — while the finding cites the file on the branch. That is why one
agent said the finding "does not apply to the file I'm responsible for": it was correct, and the routing was wrong.
Worse, integration then reported `tests_skipped: ["ci-workflow.test.js"]` because the branch already carried that
filename, so **even a successful repair would have been discarded**. The test-repair path currently cannot fix a
test file the implementer landed — the exact situation A6 describes, which makes A6 and A7 compounding rather than
independent.

*Required, and none of it is optional:* a disputing test repair must reach the same judge a code dispute does;
`resolution` must be set for every finding raised in a round, with "nobody resolved it" treated as unresolved and
carried, never dropped; and a finding must never leave a round in a state where the only thing standing between it
and a green panel is whether a cheap lens bothers to re-raise it. Until that lands, **a green panel is not evidence
that `target: "test"` findings were addressed** — which also means D1's rubber-stamping question now has one
confirmed instance to calibrate against, and Phase 4's planted defects still are not lens misses.

*Fixed in C4 by hand, not by the line:* the AC-9 defect was real, was the third instance of the same class after the
two `k1i` found, and is fixed in `3593bd3` along with an invariant test that fails on the pre-fix file and passes on
the current one, so a fourth instance cannot hide the way the first three did.

### B. Missing edges

**B1 — Memory → Build does not exist.** `grep -n "memory\|pattern\|prompt_refinement" .claude/workflows/build-spec.js` returns nothing. `/memory-roll` produces patterns and canaries (`ledger/runs/mr2-memory-roll.json` → `roll.patterns` ×10, `roll.canaries` ×10) and nothing consumes any of it. This is the edge that would catch a bad decomposition without a human in the loop.

**B2 — The canary library is not wired.** `.claude/workflows/build-implement.js:599` reads `A.canary` from `args` only; a human hand-picks one. Phase 8's exit test needs the runner to pull from `roll.canaries`.

**B3 — Graph lint belongs in code, not in the decomposer prompt.** `.claude/workflows/build-spec.js:87-93` states the rules and validates none of them. `t7`'s decomposition still shipped a false edge *and* assigned AC-12 to a task that did not own the file it names. Two checks, zero tokens: every criterion's required surface ∈ its task's `owned_surfaces`; every `depends_on` justified by a variable actually crossing.

*Fourth demonstration, run `k4`, and the clearest one yet — B3's three checks are exactly its three failures.*
A5's spec was good: 16 criteria, well-reasoned, 56 `agent()` call sites enumerated with line numbers. Its
**decomposition** was not, and the run was stopped before `/build-implement` rather than spending on it:

- **Orphaned criteria.** AC-11, AC-12, AC-15 and AC-16 are claimed by no task in the graph. AC-11 and AC-12 are the
  invariant tests — *the entire regression guarantee of the item* — assigned to nobody.
- **Duplicated assignment.** 57 criteria assignments across 12 distinct criteria. AC-8 is claimed by all ten tasks;
  AC-1 and AC-14 by nine. Ten parallel panels would each judge the same global criteria and raise the same findings.
- **False edges.** Ten tasks, nine of them `depends_on: ["t-agent-definitions"]`. No variable crosses those edges:
  the agent type names come from the Spec, not from that task's output, and each workflow task owns only its own
  `.js` file. It is "B comes after A" reasoning, which CLAUDE.md rule 1 forbids outright.

Cost avoided by catching it: `k3i` was $5.54 for **one** task. Ten tasks, nine serialized behind a barrier, would
plausibly have been $25–55 and hours of wall clock, to produce a graph whose own criteria coverage was incomplete.

**This is the second consecutive run whose decomposition defect was caught by a human reading the task graph.** That
is the argument for B3 jumping the queue: the checks are cheap, they are pure script code, and they are the
difference between the line catching this and me catching it. `build-implement` does carry an unassigned-criteria
check, so the orphans would eventually have surfaced — but only after the fan-out had been paid for.

*Third check, from run `k2i`, and it is the one that cost the most so far.* **A spec may write criteria no landed
test can ever assert, and the correctness lens will then demand tests for them forever.** `spec-wi-c8-node20-test-glob`
mixed two kinds of criterion and assigned both to one task and one test file:

- **product-scoped** — *"the `test` script is exactly `node --test substrate/test/*.test.js`"*, *"the engines floor
  equals ci.yml's node-version"*. A landed test asserts these on every run, forever. AC-4, AC-5, AC-6.
- **change-scoped** — *"every other field byte-identical **to before**"*, *"the changed paths are exactly these
  three"*, *"no dependency **is added**"*. These are assertions about a **diff**. The verifier panel can check them
  and `spec_conformance` did, and passed. A landed test cannot: after the merge there is no "before" and no "this
  change", and a test pinning `git diff` to a base sha asserts nothing once that sha is history. AC-1, AC-2, AC-3, AC-9.

The correctness lens saw AC-1/AC-3/AC-9 listed in `criteria_coverage` with no assertion covering them and, correctly
by its own contract, failed the change. The fix loop then sent three Sonnet test-repair agents to write tests that
cannot exist. Cost: 25+ minutes, ~$0.93, **one fork bomb** — a generated test ran `npm test`, which re-ran that same
test — one dispute that was right on its own terms (the finding misattributed an AC-1/AC-2 requirement to the AC-5
test), and a run that died without returning. None of the three agents was wrong; the task was impossible.

*Proposed, same shape as the other two checks and equally free:* classify every criterion in script code before the
graph is stamped. A criterion whose text is change-scoped — matching *"to before"*, *"byte-identical"*, *"changed
paths"*, *"is added/removed/upgraded"*, *"unmodified"* and their kin — is **panel-verified**, must not be counted as
a coverage gap by the correctness lens, and must never be assigned to a test file's `criteria_ids`. Carry the
classification on the criterion so the lens prompt can be told which criteria it may demand tests for. Getting this
wrong is not a cosmetic scoping error: it manufactures an unsatisfiable fix loop out of a change that was already
correct and green.

*Landed on run `k5i`, and first exercised live on `k6`.* Five checks between the `// ---- BEGIN/END graph-lint ----`
sentinels in `build-spec.js`, pure script code, zero tokens. `k6` is the first run where the lint gated a spec: the
risk router returned **low** and the code rule found nothing, so the Spec Gate exists only because the lint reported
nine violations. That is the line catching a bad decomposition instead of a human reading the task graph, which is
what B3 was for. Against `k4`'s decomposition of the same work item, replayed through the same committed block:
30 violations over 10 tasks became 9 over 3; orphans 4 → 0, duplicates 9 → 2, reachability 17 → 2.

**Four defects in the lint itself, all found by running it on real data rather than fixtures.** None changed a gate
outcome, which is why they are carried rather than hotfixed — but three of the four are false negatives, and the
design note above promises the opposite bias.

- **`criterion_reachability` cannot tell a read from a write** (two false positives on `k6`). The rule the decomposer
  prompt states is *"every surface a task's criteria require it to **write**"*. The check flags any criterion naming a
  path outside the task's `owned_surfaces`. `k6`'s AC-2 (*"the test **resolves** each name against `.claude/agents/`"*)
  and AC-10 (*"the test **reads** its frontmatter"*) name a path they only read, and were reported as violations.
  AC-10 also names a **directory** whose individual files its task did own, so containment was tested in the wrong
  direction. A false positive here stops legitimate work, which the block's own header says it must not do.
- **Check 4 classifies on a regex over prose, and a hypothetical inside a test scenario reads the same as a
  change-scoped assertion.** Replayed over `k4`, AC-11 was classed `panel` because its THEN clause contains *"a new
  `agent()` call site **is added**"* — describing a case the invariant test must catch, not an assertion about a diff.
  AC-11 *was* that spec's invariant test, the entire regression guarantee of the item. Inert today, because
  classification never creates or erases a coverage gap. The moment a lens prompt consumes the classification — which
  is the stated purpose — it inverts the `k2i` failure: instead of demanding an impossible test, it silently excuses
  a required one.
- **Nothing checks that every touched surface is owned by some task.** Check 1 maps criteria → surfaces and check 3
  maps criteria → tasks; no check maps surfaces → tasks. On `k6r`, `deploy.js`, `improve-analyze.js` and
  `memory-roll.js` were in `Spec.touched_surfaces` and owned by no task, while AC-7 requires all nine workflows to
  change. Three files would have gone silently unbuilt.
- **Nothing checks for a test-only task**, though the decomposer prompt forbids one outright. `k6` built
  `t3-agent-binding-test`, owning only `substrate/test/agent-binding.test.js` and its helper. Check 5 caught the
  upstream cause (the Spec naming those surfaces) and so the gate fired, but a decomposer can invent a test-only task
  from a clean spec and nothing would object.

**B4 — the lint gates a bad decomposition and nothing re-decomposes it.** Every violation costs a human turn.
`k4` and `k6` both ended there, and the only route from a violation back to a usable `TaskGraph` was a person.
*Proposed:* on `gate_required`, feed the violations back to the decomposer with a retry cap of two and gate only if it
still fails — the seen-set-and-round-cap shape of rule 6, applied to decomposition. Carried, not built; decide its
place on evidence. Note the measurement below before costing it.

**The decomposer failed four times on one spec, and tier is not the lever.** Same work item, same prompt, judged by
the same committed lint:

| roll | model | tasks | violations | false edges | duplicates | orphans | cost |
|---|---|---|---|---|---|---|---|
| `k4` | haiku | 10 | 30 | 0 | 9 | 4 | in `k4`'s $1.02 |
| `k6` | haiku | 3 | 9 | 3 | 2 | 0 | in `k6`'s $0.92 |
| `k6r` | haiku | 7 | 15 | 6 | 4 | 5 | $0.06 |
| `k6s` | **sonnet** | 3 | **18** | **0** | **11** | 1 | **$0.27** |
| `k6h` | **script (human)** | 2 | **0** | 0 | 0 | 0 | **$0** |

Raising the tier cost 4.5× and produced *more* violations, but of an inverted kind: sonnet got the **dependency
graph exactly right** (zero false edges, the thing haiku failed three times out of four) and the **criterion
assignment badly wrong** (11 of 13 criteria claimed by all three tasks). That inversion is the diagnosis.

**The root cause is a property of the Spec, not of the model.** A5's acceptance criteria are *global invariants over
the whole tree* — "every option object names an `agentType`", "`npm test` passes", "no call site is re-labelled or
re-tiered". A global criterion cannot be partitioned across a per-file decomposition: split the files and each one
must be either duplicated into every task or orphaned. Sonnet chose duplicate, haiku chose orphan, and the lint
correctly reported both. The decomposer prompt already carries the right rule — *"Prefer ONE task; split only when
two disjoint code surfaces can be built independently"* — and **all four rolls ignored it**. The clean graph stops
splitting: one task owns all nine workflow files, one owns the agent definitions, and no edge joins them.

*So the sixth check worth more than B4's retry loop:* when a Spec's criteria are predominantly global (a criterion
naming no single path, or naming several of the Spec's surfaces at once), a decomposition into more than one task
that owns code is itself the violation. That check is free, and on this evidence it would have caught all four rolls.

*What this does and does not say about tier.* It corroborates the tier table above rather than overturning it: the
failures are structural. It is one work item and one roll per tier, so it is not a rate — but it is the first
controlled comparison in the ledger (identical prompt, identical Spec, identical judge, one variable), and it says
the cheap decomposer's weakness is dependency reasoning while the mid tier's is scope. Neither is fixed by paying more.

**B5 — A task that needs a value its sibling creates has no way to get it, and the line cannot recover.**
Found on `k7`. The coupled value — twelve agentType name strings — did not exist until `t1` implemented, so no Spec
could have carried it and no edge was drawn. `t2` could not see `t1`'s worktree, so it invented the values and wrote
into `t1`'s surface. A3 detected every stray correctly; nothing then repaired it, and a human had to (`k7d`). Every
further multi-task spec with an interface between tasks will hit this, and naming the value in the Spec is not a
general answer because the value is usually unknown at spec time. The goal is that this costs no human turn.

Options, not yet decided — cheapest and most general first:

1. **Repair in code from the boundary facts.** `sibling_owner` strays are facts, so the script can derive the repair
   without judgment: discard the strays, add the edge `owner → strayer` that should have existed, and re-run the
   strayer branched from the owner's finished task branch, where the values now exist. One retry, round-capped;
   escalate only if the re-run strays again. Handles values nobody knew at spec time. Costs one extra implementer run
   of the strayer, and serialises the pair.
2. **Let the implementer ask instead of invent.** Add a `needs_from_sibling: [{surface, what}]` field to the
   implementer's ChangeSet and forbid writing outside owned surfaces in its prompt; a non-empty field triggers option 1
   before any panel or tokens are spent on a patch that cannot integrate. Pairs with 1; not sufficient alone.
3. **Catch it at decomposition (B3's sixth check).** A criterion whose `given` spans surfaces owned by two tasks (here
   AC-2: names *referenced by t2's call sites* must resolve in *t1's directory*) means either one task or an edge.
   Free and early, but only catches couplings the criteria happen to state.

*Recommended:* 1 + 2, with 3 as cheap prevention. Also observed on `k7`, smaller: `integrate:resolve` ran at the
strong tier with **zero** passing tasks (165k tokens resolving nothing), and integration then reported the 24
pre-existing `substrate/test/*.test.js` files as "unaccounted TestSet files" — a false alarm when no task landed.

*Landed at `k9d`, by direct drive of `k9b`* (spec `k8`, gate `k8-spec_gate` approved by the human; `k9` refused on
C12; `k9b` escalated; choice made by the main session under the operating rule above). All three options plus both
integrate fixes: `boundaryRepair`, `repairOwners`, `isMutualWait`, `unaccountedTestFiles` in the fix-loop block;
`routeBoundary` / `resolveBoundaryDecision` / `repairRerun` wired at both boundary sites and ahead of the empty-diff
gate; `ChangeSet.needs_from_sibling` and `EvidenceBundle.boundary_repairs` in the contract; `criterion_coupling` as
graph-lint check 6. `k9b` cost $2.83 (sonnet $1.76, haiku $0.86, opus-5-5 $0.20); B5 total with `k8` and `k9`
$3.32. **What the line could not do:** its Test Author wrote six wiring tests that located code by its first
*textual* occurrence (a definition rather than a call, a variable name rather than the output field, a backtick the
source never used), and a fixer bent correct code to satisfy two of them. The panel missed two real defects the main
session then found by reading the diff: dependents branched from `task/<dep>` — the stray branch a repair abandons —
and `criterion_coupling` used undirected connectivity, so two tasks sharing a parent read as ordered while running in
parallel. Both fixed with tests; nine planted defects each turn a test red. **Not yet exercised live:** B5 changes
`build-implement.js`, so the repair first engages on the next multi-task run. Watch the first `boundary_repairs`.

**B6 — A failing test counts against the implementation before anyone has checked the test is valid.**
Found on `k9b`. Of seven failures, four were test defects and one more was hidden by a fixer rewriting code to
match a test; `k9b` escalated a correct implementation after 1.28M tokens, and the escalation packager reported a
failure that did not reproduce. Every failing test currently reaches the correctness lens as evidence against the
code, and the lens files it `target: implementation` by default; `testRepairTarget` only routes a finding to the
Test Author when the lens already said `target: test`. Nothing in the line asks the question first. *Design, cheapest
first, all derived in code from facts a detector reports:*
1. **Validity facts before blame.** For each failing test, a cheap detector reports facts only — does the assertion
   locate code by first textual occurrence or a declaration; does it require a literal the Spec does not quote;
   does it fail on the base commit for the same reason; does the failure message name the criterion's behaviour.
   Script code derives `test_defect` vs `code_defect`. A `test_defect` goes to the Test Author (existing
   `testfix:` path) and never to a fixer; only `code_defect` counts toward the panel verdict.
2. **The fixer may not change code only to satisfy a test's textual form.** A fix whose diff touches no behaviour
   the finding names (a relabel, a declaration moved) is refused in code, and the finding is re-routed as 1.
3. **Test Author guidance with a tool, not a sentence:** source-text wiring tests assert calls and their order
   inside a named function using `substrate/test/b5-wiring-helpers.js`; a literal only when the Spec quotes it.
4. **Mutation sanity on new tests (optional, cheap):** a mechanical agent plants one defect in the criterion's code
   path; a test that stays green is reported as vacuous before it is trusted.

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

*Built through the line as `wi-c4-ci` (`k1b` spec → `k1i` implement → `k1v` re-panel). `.github/workflows/ci.yml`
plus a 17-test `substrate/test/ci-workflow.test.js`. **Landing knowingly red** — see C8, which CI found on its own
first run.*

**C8 — `npm test` is broken on Node 20 in both packages, and `engines.node` has been claiming `">=20"` regardless.**
Found by CI four minutes after C4 gave the repository a CI, on Actions run `34667094594` (commit `8f77338`).

Both test scripts quote their glob — root `node --test "substrate/test/*.test.js"`, toy
`NODE_ENV=test node --test "test/*.test.js"`. Quoted, the shell never expands it, so Node is handed a literal
pattern. Node 22 accepts glob patterns for `--test`; **Node 20 does not**, and exits 1 with
`Could not find '.../substrate/test/*.test.js'`. CI pins Node 20 *because it was told to match `engines.node`*, so
CI is red on every push.

The measured facts, none of them assumed:
- This container is Node **22.22.2**, which is why every green number in §5 was green.
- Unquoting works: `node --test substrate/test/*.test.js` gives **114/114** here, and is the portable form on 20.
- `node --test substrate/test/` is **not** a substitute — Node resolves a bare directory as a module path and throws
  `MODULE_NOT_FOUND`.

So `engines.node: ">=20"` is false and has always been false. Nobody could have known, because nothing had ever run
these suites anywhere but a developer's machine — which is the precise gap C4 exists to close, closed on run 1.
**This is the single best piece of evidence in the ledger that CI earns its keep**, and it cost one push to obtain.

*Resolution is a real choice and `wi-c8-node20-test-glob` must make it explicitly:* (a) unquote both globs, keeping
the `">=20"` promise and making it true for the first time; or (b) admit the floor is Node 22 — `engines.node` to
`">=22"`, CI `node-version` to 22, and amend `spec-wi-c4-ci`'s AC-4, which asserts 20 and is enforced by the landed
test. (a) is smaller and keeps the stated promise; (b) is defensible only if something actually needs 22, which
should be checked rather than assumed. Either way the deliverable must include **CI going green on a push** — a
claim of "fixed" is worth nothing unless the thing that caught it agrees — plus a test pinning `engines.node` and
the workflow's `node-version` to each other so they cannot drift apart silently again.

**C9 — A closed `escalation` gate is never verified by anything; only `spec_gate` is.**
`.claude/workflows/build-implement.js:454-469` reads the gate record from `gates/` and refuses unless it is
`decided` / `spec_gate` / `approve` — but the whole block is guarded by `pendingSpecs.length > 0`, so it fires only
for a spec carrying `gate:"pending"`. An **escalation** gate authorises exactly as much real work (on `k1i` it
authorised a `direct_driver` edit to the change under review and a re-panel) and passes through no check at all: the
next run simply proceeds, and a decision that exists only in `args`, or nowhere, is indistinguishable from a decided
one. This is the same hole commit `74aabe1` closed for the Spec Gate — *"the Spec Gate was openable but
unverifiable"* — still open one gate over. Fold into whichever item touches the gate-verification path; it is a few
lines beside the existing check, and it wants the same mechanical-agent read of the closed record by id.

**C10 — Five files each resolve the repository root by counting `..`, and three export their own copy of it.**
`ci-workflow.test.js:21`, `fixloop-helpers.js:14`, `helpers.js:7`, `node-support-floor-and-test-glob.test.js:24` and
`t2-doc-paths.js:15` all carry `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')`. Three of them
export that as `REPO`, so one fragile definition exists three times and is imported by at least six test files.

It is right only while the file sits exactly two levels under the repository root — and this repo routinely runs test
files elsewhere: `/build-implement` writes TestSets to `.artifacts/tests/<task>/` and may run them there before they
land, and AC-15-style tests copy the tree into a throwaway directory. At any other depth `REPO` silently points at the
wrong directory. Same class as C1: correct only at the location it was born in, and it has already bitten once, when a
landed TestSet hardcoded the gitignored worktree it was authored in.

*The fix is already written.* Run `k1v`'s Test Author produced `repo-root.js`, which walks up until it finds a
directory holding both `contracts.schema.json` and `package.json`, and throws a named error rather than returning a
wrong answer. It was **not** merged with C4 — unused, and outside that spec's `touched_surfaces` — and is salvaged at
`.artifacts/salvage/repo-root.js`. **That path is gitignored and dies with the container**, so read it or reproduce it.
Carried as `wi-c10-repo-root-resolution`. The test that matters resolves the root from a file at a *different* depth;
a resolver only ever exercised from its birthplace proves exactly what the hardcoded version already proved.

**C11 — `ledger recost` clobbers run files and re-serialises the whole index.** Found adding the `claude-opus-5-5`
rate ($4 / $20 per MTok, same claude-api reference the file already cites; cache reads $0.20 ignored by the blend).
`substrate/ledger.js` `recost` writes each index row back over `ledger/runs/<id>.json`'s `entry`, so any run file
corrected after append loses the correction: a full recost set `k1`'s tokens from 3,410,972 back to the index's
122,328 (and priced it $0.56 instead of $15.83), dropped `m2`'s `wall_clock_unknown`, and rewrote 49 index lines only
to change their key spacing. The index and the run files had already drifted apart; `recost` picks the index as truth
without saying so. Reverted; the `k7` row alone was re-priced by hand ($1.38 → $2.31; Opus 5.5 is $0.93 of that),
ledger total $84.89 → $85.82. *Fix:* recost only `cost_est_usd` in both places, surgically, and have a check that
fails when `index.jsonl` and `runs/<id>.json` disagree on anything but that field.

**C12 — The spec-gate check's mechanical reader copied the gate's `id` into `gate`, and the build refused.**
Run `k9` (build-implement, B5): `gates/closed/k8-spec_gate.json` says `id: "k8-spec_gate"`, `gate: "spec_gate"`,
`status: "decided"`, `decision.option: "approve"`. The haiku `gate:spec_gate` agent returned `gate: "k8-spec_gate"`,
so `ok` was false and the run refused at 12k tokens before any task started. Failing closed is correct; the defect is
that the `GateCheck` schema has no `id` field, so the one value on the record that looks most like "the gate" has
nowhere to go but `gate`. *Fix:* add `id` to `GateCheck` and check `g.id === A.gate.gate_id` as well, so a miscopy
fails on a named field instead of a plausible-looking one. Re-run unchanged as `k9b`.

**C13 — The risk router's code rule reads `test-author.md` as an auth surface.** `build-spec.js` `HIGH_REF` is
`/\bauth|.../i`; `\bauth` matches "**auth**or" after the hyphen, so `k10` routed B6 high with the reason
"surface ref names a sensitive term: .claude/agents/test-author.md". Harmless on `k10` (its `contracts.schema.json`
surface is high by kind anyway) but any spec touching only the Test Author definition would gate for no reason.
*Fix:* `\bauth(?:[nz]|entic|oriz)?\b` or an explicit word list, with a test naming `test-author.md`.

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
