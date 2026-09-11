# substrate/ — what runs between the workflows

The workflow runtime cannot pause for a person, read a clock, count its own tokens, or touch disk. This directory holds the four things that live outside a run so that the graph can still have gates, a ledger, an artifact store, and validated contracts.

| CLI | Purpose |
|---|---|
| `node substrate/validator.js <Def> <file.json>` | Check any JSON against a named `$def` in `contracts.schema.json`. Exit 0 valid, 1 invalid. `--list` prints the defs. |
| `node substrate/artifacts.js` | Artifact store under `.artifacts/`. See `.artifacts/README.md`. |
| `node substrate/gates.js` | Gate queue. Open a decision for the human, list open ones, record the decision. |
| `node substrate/ledger.js` | Run trace and Method Ledger. Append every workflow return; summarize by method, workflow, or node. |
| `node substrate/deploy.js` | Local deploy target for Launch: one env = one port + one detached process + one worktree pinned at a sha. `checkout`, `start`, `stop`, `status`, `probe` (canary vs baseline, raw JSONL + summary), `promote`, `remove`. Writes `Deployment` records under `.artifacts/deploy/<project>/`. |

All five are also `npm run` scripts and `bin` entries. Tests: `npm test`.

## The gate-turn protocol

A human gate is a workflow boundary (CLAUDE.md rule 8). One stretch of the line looks like this, from the main Claude Code session:

1. Run the workflow, e.g. `/build-spec` with `args` including `run_id` and `now`.
2. When it returns, append the return value to the ledger. The runtime reports tokens per run; the script cannot see them, so they are passed in here:
   ```
   node substrate/ledger.js append --workflow build-spec --run r1 --started <args.now> --result <saved return>.json --tokens <from /workflows> --journal <transcript dir>/journal.jsonl
   ```
3. If the return contains anything a human must decide (a `gated` list, an `Escalation`, a review package, a `VentureVerdict`), open a gate for it:
   ```
   node substrate/gates.js open --gate spec_gate --run r1 --workflow build-spec --options approve,revise,kill --payload gated.json --next build-implement
   ```
4. The human runs `node substrate/gates.js list`, reads the record, and decides:
   ```
   node substrate/gates.js decide r1-spec_gate approve --note "ship it"
   ```
   The record moves to `gates/closed/` and the command prints the `args` fragment the next workflow takes.
5. Run the next workflow with that decision in `args`.

The Create + Launch stretch has two gates, both opened this way. `brief_approval` is opened on the drafted `ProjectBrief` (options `sign,revise`) and `/create-project` verifies the closed record before provisioning. `launch_approval` is opened on the `ReviewPackage` that `/launch` returns, with the package's own `options` (`approve,veto` on a go; `veto,approve_override` on a no-go), and `/deploy` verifies that record before it starts a canary. Neither workflow trusts a decision passed in `args` alone; the gate file is the signature.

`gates/` and `ledger/` are committed. They are the plant's memory of every human decision and every run's cost; `.artifacts/` is not committed.

### Stale gates

The runtime has no timers, so "a gate timeout escalates, never auto-approves" is a check, not an event: `node substrate/gates.js list --stale 24` lists gates open longer than 24 hours. A scheduled session can run it.

## Records the substrate writes

Both are `$def`s in `contracts.schema.json` and are validated on every write.

- `GateRecord`: `id, gate, run_id, workflow, status (open|decided), opened_at, options[], payload | payload_ref, next_workflow, decision {option, note, decided_by, decided_at}, provenance`.
- `LedgerEntry`: `id, run_id, workflow, status, started_at, finished_at, wall_clock_sec, tokens, agents, human_min, artifact_count, escalations, result_ref, trace_ref, provenance`.

`ledger summary --by method` groups run-level tokens, wall clock, human minutes and escalations by the run's `provenance.method`. `--by node` walks every nested artifact in every stored result and groups by `provenance.node`, using `provenance.tokens` where a script stamped it. Per-agent token attribution is the runtime's to expose; until it does, node rows show artifact counts and run rows carry the real cost.

## Agents

`.claude/agents/` holds the subagent definitions the workflows bind to with `agentType`: `implementer`, `test-author`, `fixer` (mid tier, full tools), `lens-spec-conformance`, `lens-security`, `lens-correctness` (cheap tier, read-only), and `mechanical` (cheap tier, shell and filesystem, no judgment). Tiering follows CLAUDE.md.

## Permissions

`.claude/settings.json` allows git, node, npm and writes under `.artifacts/`, `gates/`, `ledger/`, and `toy/` so a long run does not stall on prompts. Workflow agents inherit the session's permissions; agent `tools:` lists can only narrow them.

## Deploy target

`deploy.js` is deliberately dumb: every subcommand is one deterministic shell step a mechanical agent can run verbatim, and it prints JSON the agent copies into a schema. The regression rule (error-rate delta, p95 factor, minimum probe count, a dead baseline is inconclusive) lives in `.claude/workflows/deploy.js`, in script code, so the verdict is derived where the numbers cross the edge and no agent ever declares a canary healthy. A watch that cannot measure (too few probes, baseline unreachable) rolls back; nothing passes by default.

## Cost

Tokens are not comparable across model tiers, so every ledger row carries `tokens_by_model` (the runtime's per-agent
count, summed per model id) and `cost_est_usd`. Prices and the blend assumption live in `substrate/lib/pricing.json`:
the runtime reports one token count per agent with no input/output split, so each model's tokens are priced at a
blended rate (default 90% input, 10% output; cache reads ignored). Pass `--tokens-by-model '{"claude-opus-5": N, ...}'`
to `ledger append`; `ledger recost` reprices every row after editing the pricing file; `ledger summary --by model`
shows where the money goes.
