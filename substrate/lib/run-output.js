#!/usr/bin/env node
// Reads a Workflow task output file (the JSON the runtime writes when a run completes: summary, logs, result,
// workflowProgress with one entry per agent carrying model + tokens) and prints what `ledger append` needs.
//   node substrate/lib/run-output.js <task.output> [--save <path>]   → prints {agents, tokens_by_model}; --save writes .result to <path>
import fs from 'node:fs'
const [file, ...rest] = process.argv.slice(2)
if (!file) { console.error('usage: run-output.js <task.output> [--save <path>]'); process.exit(2) }
const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
const agents = (doc.workflowProgress ?? []).filter(a => a && a.type === 'workflow_agent')
const byModel = {}
for (const a of agents) { const m = String(a.model ?? 'unknown').replace(/-\d{8}$/, '').replace(/\[.*\]$/, ''); byModel[m] = (byModel[m] ?? 0) + (a.tokens ?? 0) }
const i = rest.indexOf('--save')
if (i >= 0 && rest[i + 1]) { fs.writeFileSync(rest[i + 1], JSON.stringify(doc.result, null, 2) + '\n') }
console.log(JSON.stringify({ agents: agents.length, tokens_by_model: byModel, logs: doc.logs ?? [] }))
