# CLAUDE.md — Company Super Graph

This repository is **a company designed as an agent graph** — a plant that runs product lines (ventures), builds its own machines, maintains and improves itself — plus the workflows that run it. This repo is itself **venture 0**: the plant builds its own machines on its own production line.

Read in this order: `COMPANY.md` (Level 0 — the plant), `OPERATING_MODEL.md` (the production line one venture runs), `contracts.schema.json` (every edge shape), `.claude/workflows/*.js` (what exists so far), `HANDOFF.md` (what to build next and how it's tested).

## Non-negotiable rules

1. **An edge exists only if a variable crosses it.** Never chain two agents because "B comes after A." If B's inputs don't include A's output, they run in parallel.
2. **Every `agent()` call carries a `schema`.** Free text never crosses an edge.
3. **Edges are script code.** Dedupe, route, adjudicate, merge lists, count — plain JavaScript in the workflow body, zero tokens. Agents are for judgment and for anything that touches the filesystem or shell (the runtime forbids the script itself from doing that).
4. **Fresh context per node.** Each agent receives exactly its contract inputs, passed explicitly in the prompt. Large artifacts are written to disk by an agent and passed by path (`*_ref`), never inlined.
5. **Verifier lenses never see the implementer's `notes`.** Strip it in the script before building lens prompts.
6. **Cycles converge or escalate.** Seen-set includes rejected items; round cap; budget cap; explicit escalation output.
7. **`pipeline()` by default; `parallel()` only when the next stage needs every result.** The only true barrier in Build is integration.
8. **Human gates are workflow boundaries.** The runtime cannot pause for a person mid-run, so each stretch between gates is its own workflow, and the gate is a conversational turn where the human reviews the previous run's output and invokes the next workflow with their decision in `args`.
9. **No `Date.now()`, `Math.random()`, `import`, `require`, `fs`, or shell in a workflow script.** Timestamps and run ids arrive via `args`. Anything mechanical that needs disk or shell is a cheap-model agent with a deterministic prompt.
10. **Provenance on every artifact** — `node, executor, method, model, run_id, created_at`. The script stamps it; agents don't. This feeds the Method Ledger, which is the point of the whole model.

## Working methods (project vocabulary — intentionally non-standard)

| Method | Meaning here | Runtime behavior |
|---|---|---|
| `dark_factory` | full AI autonomy | run, no notification unless budget breached |
| `hotl` | AI acts, human audits and can veto | run; output lands in review queue; proceed |
| `hitl` | AI pauses for approval | **workflow boundary**; human decides in chat, next workflow takes the decision as `args` |
| `direct_driver` | human in command, AI copilot | human does it in an ordinary Claude Code session; record provenance |
| `human` | no AI | record only |

## Repository layout

```
COMPANY.md                  Level 0 — the plant: strategy, tooling, maintenance, process eng, ops, governance
OPERATING_MODEL.md          the production line, all levels
contracts.schema.json       26 edge contracts (JSON Schema 2020-12)
HANDOFF.md                  build phases, exit tests, exact prompts
.claude/workflows/          one workflow per stretch between human gates
.claude/agents/             subagent definitions (model, tools, role) — to be created in Phase 0
substrate/                  to be created in Phase 0: artifact store, gate queue, ledger, run trace
```

## Model tiering

Strong: spec writing, tiebreak, dispute ruling, escalation packaging, opportunity synthesis, integration conflicts.
Mid: implement, test author, fixer, fix planner, root cause.
Cheap: risk router, decomposer, all verifier lenses, triage, feedback analyst, and every mechanical agent (run tests, merge patches, read/write artifacts).

When writing a workflow, use `/workflow-authoring` first for the runtime reference, then apply the rules above. Where this file and the runtime reference conflict on mechanics, the runtime wins; where they conflict on structure (what is an edge, what is a barrier), this file wins.
