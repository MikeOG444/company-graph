#!/usr/bin/env node
// Reads a Workflow task output file (the JSON the runtime writes when a run completes: summary, logs, result,
// workflowProgress with one entry per agent carrying model + tokens + timing) and derives what `ledger append`
// needs: agent count, per-model token sums, the total, and both timestamps.
//
// Each `workflowProgress` entry of type "workflow_agent" may carry, in epoch milliseconds:
//   queuedAt, startedAt, lastProgressAt, durationMs
// started_at is the ISO of the minimum queuedAt/startedAt across all agents; finished_at is the ISO of the
// maximum lastProgressAt (or startedAt + durationMs where lastProgressAt is absent). An agent with none of
// these contributes tokens but not timing.
//
//   node substrate/lib/run-output.js <task.output> [--save <path>]
//     prints {agents, tokens_by_model, logs, started_at, finished_at, tokens}; --save writes .result to <path>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeModel } from './pricing.js'

/**
 * Pure(-ish) derivation from a task output file: no writes, no process.exit — throws on anything unreadable
 * or unusable so callers (the run-output CLI, `ledger append --from-output`) can report and exit however they like.
 * @param {string} file
 * @returns {{doc:object, agents:number, tokens_by_model:Record<string,number>, tokens:number,
 *            started_at:string|undefined, finished_at:string|undefined, logs:any[], result:any}}
 */
export function readRunOutput(file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') }
  catch (e) { throw new Error(`cannot read task output at ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`) }
  if (!text.trim()) throw new Error(`task output at ${file} is empty`)
  let doc
  try { doc = JSON.parse(text) }
  catch (e) { throw new Error(`task output at ${file} is not valid JSON: ${e.message}`) }

  const progress = Array.isArray(doc.workflowProgress) ? doc.workflowProgress : []
  const agents = progress.filter(a => a && a.type === 'workflow_agent')
  if (!agents.length) throw new Error(`task output at ${file} has no workflow_agent entries in workflowProgress`)

  const tokens_by_model = {}
  for (const a of agents) {
    const m = normalizeModel(a.model ?? 'unknown')
    tokens_by_model[m] = (tokens_by_model[m] ?? 0) + (a.tokens ?? 0)
  }
  const tokens = Object.values(tokens_by_model).reduce((x, y) => x + y, 0)

  const starts = []
  for (const a of agents) {
    if (typeof a.queuedAt === 'number') starts.push(a.queuedAt)
    if (typeof a.startedAt === 'number') starts.push(a.startedAt)
  }
  const ends = []
  for (const a of agents) {
    if (typeof a.lastProgressAt === 'number') ends.push(a.lastProgressAt)
    else if (typeof a.startedAt === 'number' && typeof a.durationMs === 'number') ends.push(a.startedAt + a.durationMs)
  }
  const startMs = starts.length ? Math.min(...starts) : undefined
  const endMs = ends.length ? Math.max(...ends) : undefined

  return {
    doc,
    agents: agents.length,
    tokens_by_model,
    tokens,
    started_at: startMs !== undefined ? new Date(startMs).toISOString() : undefined,
    finished_at: endMs !== undefined ? new Date(endMs).toISOString() : undefined,
    logs: doc.logs ?? [],
    result: doc.result,
  }
}

function main() {
  const [file, ...rest] = process.argv.slice(2)
  if (!file) { console.error('usage: run-output.js <task.output> [--save <path>]'); process.exit(2) }
  let out
  try { out = readRunOutput(file) }
  catch (e) { console.error(e.message); process.exit(2) }
  const i = rest.indexOf('--save')
  if (i >= 0 && rest[i + 1]) fs.writeFileSync(rest[i + 1], JSON.stringify(out.doc.result, null, 2) + '\n')
  console.log(JSON.stringify({
    agents: out.agents, tokens_by_model: out.tokens_by_model, logs: out.logs,
    started_at: out.started_at, finished_at: out.finished_at, tokens: out.tokens,
  }))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
