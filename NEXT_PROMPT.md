# Next session — venture 0 carry list, continued

Repository `MikeOG444/company-graph`. Develop on the branch the session assigns, and ask before using any other.
**Verify state before trusting this file:** `git log --oneline -5 origin/main`, `npm test` (root) and `cd toy && npm test`.
Expected on handoff: `main` at `bf07c80` (PR #84 merged), root 471/471, toy 60/60.

Read in this order: `CLAUDE.md`, `HANDOFF.md` §6 (the carry list — every item names its evidence), then
`.claude/workflows/build-implement.js` and `build-spec.js` headers (the args each run takes).

## Where things stand (2026-09-27)

Landed this stretch, each by direct drive of a line run that escalated (see the HANDOFF §6 entry for each):

| item | run | what |
|---|---|---|
| B5, B6, C5, B8 | k9d, k11d, k13d, k15d | earlier in the stretch (PR #10) |
| C13 + B7 part 1 | k17d | auth false positive; change-scoped criteria never become tests |
| B7 part 2 + C10 | by hand | `a5-bind-AC-13` EXTENSIONS list; every helper resolves `REPO` from cwd (PR #11) |
| **B1 + B2** | k19d | `args.memory_ref`: patterns into the Decomposer prompt; library canary via `selectCanary` (PR #11) |
| **C15 + C12 + C14** | k21d | budgets in billed tokens (hard stop 2×); gate id miscopy re-read once; stray-file report (PR #84) |
| **C16** | k21d | the suite no longer delivers real notifications (`substrate/test/no-live-notify.js`) |

**None of B1, B2, C12, C14 or C15 has run on the line yet.** Workflows run their committed copy, so the first
build after PR #84 is the first to exercise them. Check its output for `spend.billed_per_output`,
`over_budget`, `stray_files`, `stray_baseline_source` and `canaries`.

Ledger total ≈ **$112.75**. This stretch cost: k18 $0.26, k19 $7.00, k20 $0.25, k21 $3.04. Pricing (looked up):
opus-5-5 $4 in / $20 out per MTok; the ledger holds the rest.

## Environment

Environment `Company_Graph_Cloud_Env` carries `NOTIFY_DRIVER=github`, `NOTIFY_GITHUB_REPO=MikeOG444/company-graph`
and `NOTIFY_GITHUB_TOKEN`. **Gates now open real GitHub issues.** The suite is guarded: `npm test` preloads
`no-live-notify.js`, and `helpers.js` / `c5-env-helpers.js` import it. Anything that runs tests another way must
strip `NOTIFY_*` first. The 72 issues the leak opened (#12–#83) were closed as not planned.

## Launching a build — args that matter now

- `work_item_budgets[*].tokens`, `budget.task_tokens` and `budget.round_tokens` are **billed** tokens.
  - The script converts them at `billed_per_output` (default 4; measured 3.5–4.6 on k7–k21).
  - Going over 1× records an `over_budget` entry; 2× is the hard stop.
  - Omit `round_tokens` unless you want a per-round cap: the default round cap equals the task cap. The old task÷3 default stopped k1i, k7 and k21 in round 1.
  - Recent builds bill 1.1–3.1M, so budget WorkItems realistically (about 1.5M).
- Pass `untracked_baseline: [...]` as the output of `git status --porcelain --untracked-files=all` at launch, minus `.artifacts/`.
- Pass `memory_ref: "ledger/runs/mr2-memory-roll.json"` to feed Memory into the build: patterns go to the Decomposer, and canaries go to tasks that own a path a mutation names.
- Put this in `test_hint` every time, because it prevents most test defects seen so far:
  - Test file prefix is `kNN-`.
  - Copy helpers into the TestSet and import them as `./x.js`.
  - Never write into the worktree's `substrate/test/`.
  - Wiring assertions go through `b5-wiring-helpers`.
  - Match prose with `\s+`, not exact line wraps.
  - Don't test change-scoped criteria.
  - Never shell out to `npm test`.
- Launch by `scriptPath`; `run_id` and `now` go in `args`, and `now` is the real time.

## Working rules (carried, unchanged)

- Merge with a **merge commit**, never squash or rebase; the ledger cites shas. `git push --delete` is blocked; the human deletes branches in the UI.
- Verdicts are derived in script code; agents detect, never vote. No agent writes a nested artifact.
- `.artifacts/` is gitignored: copy a failed run's patches and TestSet into `ledger/runs/<run_id>/`.
- **Operating rule (HANDOFF §6):** the main session decides option menus and escalations itself and records why. Ask the human only for:
  - spend beyond about 2× a WorkItem's budget;
  - irreversible or outward-facing acts (merge, delete, publish, bulk GitHub actions);
  - a strategy or order-of-work change;
  - a figure that cannot be looked up.

  A Spec Gate on a high-risk spec is still opened for the human.
- **A failing test is a question, not a verdict.** Check whether the test or the code is wrong. Recurring test defects this stretch:
  - whitespace-sensitive prompt matching;
  - frozen exact strings ("unchanged", "exactly five", the `npm test` string);
  - tests needing a helper the lander skips.

  Fix the test, and never bend correct code to fit it.
- **Review by hand before landing:**
  - run the TestSet against the implementation;
  - read the diff;
  - **execute the workflow's top level** (k21 would have crashed at startup, and no block-only test could see it);
  - plant mutations until each change has a test that turns red.

  Record a `kNNd` ledger row (`direct_driver`, `main-session`) and a HANDOFF entry.
- Report cost by model and the human-action count honestly. Keep HANDOFF §6 current.

## What to do next — the human decides the order

The confirmed order of work is exhausted. Candidates, with my recommendation first:

1. **First live run of the new machinery.** Run the next build with `memory_ref`, `untracked_baseline` and a realistic budget, and confirm B1, B2, C12, C14 and C15 behave as specified on a real run. Pair it with a small real item so the run is not spent on a test fixture: **C11** (`ledger recost` clobbers run files) or **C9** (closed escalation gates are never verified).
2. **B4:** the lint gates a bad decomposition and nothing re-decomposes it, so every violation costs a human turn.
3. **A1–A3:** the lens-worktree fix is prompt-only (A1); the bootstrap lag (A2); the owned-surfaces boundary is enforced but has never run (A3).
4. **Phase 8** (Plant Maintenance + Registry). Its exit test needs the canary runner that B2 now feeds.
5. **HANDOFF §6 E** (Roadmap Gate items, rank order): `opp-p5-2`, `opp-p5-1`, `opp-p5-6`, `opp-p5-7`, `opp-p5-8`. Also C1–C3 and D1–D3.
