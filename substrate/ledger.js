#!/usr/bin/env node
// Run trace + Method Ledger. Every workflow return is appended here with provenance, tokens, wall clock.
// The script cannot see its own tokens or a clock, so this runs AFTER the workflow returns, from the main session.
//
//   ledger append --workflow <name> --run <run_id> --started <iso> --result <file.json>
//                 [--tokens N] [--agents N] [--human-min N] [--status ok|failed] [--journal <path>] [--now <iso>]
//   ledger list [--json]
//   ledger summary [--by method|workflow|node] [--json]
//   ledger show <run_id>
import fs from 'node:fs'
import path from 'node:path'
import { ARTIFACTS, LEDGER, ensureDir, absToRef, parseArgs, die, readJson, writeJson, nowIso } from './lib/paths.js'
import { validate, formatErrors } from './lib/contracts.js'

const RUNS = path.join(LEDGER, 'runs'), INDEX = path.join(LEDGER, 'index.jsonl')
const { pos, opts } = parseArgs(process.argv.slice(2))
const [cmd, a] = pos

const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_')
function readIndex() {
  if (!fs.existsSync(INDEX)) return []
  return fs.readFileSync(INDEX, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}
const int = (v, name) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isInteger(n) || n < 0) die(`--${name} must be a non-negative integer`); return n }

// Walk a result and collect every object carrying a provenance block: that is one artifact per node.
function artifacts(obj, out = []) {
  if (Array.isArray(obj)) obj.forEach(o => artifacts(o, out))
  else if (obj && typeof obj === 'object') {
    if (obj.provenance && typeof obj.provenance === 'object') out.push(obj.provenance)
    for (const v of Object.values(obj)) artifacts(v, out)
  }
  return out
}

switch (cmd) {
  case 'append': {
    const { workflow, run, started, result } = opts
    if (!workflow || !run || !started || !result) die('usage: ledger append --workflow <name> --run <run_id> --started <iso> --result <file.json> [--tokens N] [--agents N] [--human-min N] [--status ok|failed] [--journal path] [--now iso]')
    if (Number.isNaN(Date.parse(started))) die(`bad --started timestamp: ${started}`)
    const payload = readJson(result)
    const finished_at = nowIso(opts.now)
    const started_at = new Date(started).toISOString()
    const wall = Math.max(0, Math.round((Date.parse(finished_at) - Date.parse(started_at)) / 1000))
    ensureDir(RUNS)
    const id = `${safe(run)}-${safe(workflow)}`
    const runPath = path.join(RUNS, `${id}.json`)
    const entry = {
      id, run_id: run, workflow, status: opts.status ?? 'ok', started_at, finished_at, wall_clock_sec: wall,
      result_ref: absToRef(runPath),
      artifact_count: artifacts(payload).length,
      escalations: Array.isArray(payload.escalations) ? payload.escalations.length : 0,
    }
    const tokens = int(opts.tokens, 'tokens'); if (tokens !== undefined) entry.tokens = tokens
    const agents = int(opts.agents, 'agents'); if (agents !== undefined) entry.agents = agents
    const human = int(opts['human-min'], 'human-min'); if (human !== undefined) entry.human_min = human
    if (payload.provenance) entry.provenance = payload.provenance
    else entry.provenance = { node: workflow, executor: 'ai_agent', method: 'hotl', run_id: run, created_at: started_at }
    if (opts.journal) {
      if (!fs.existsSync(opts.journal)) die(`no journal at ${opts.journal}`)
      const tr = path.join(ARTIFACTS, 'traces', `${id}.jsonl`)
      ensureDir(path.dirname(tr)); fs.copyFileSync(opts.journal, tr)
      entry.trace_ref = absToRef(tr)
    }
    const v = validate('LedgerEntry', entry)
    if (!v.ok) die(`LedgerEntry invalid:\n${formatErrors(v.errors)}`)
    if (fs.existsSync(runPath)) die(`ledger already has ${id}; a re-run needs a new run_id`, 1)
    writeJson(runPath, { entry, result: payload })
    ensureDir(LEDGER); fs.appendFileSync(INDEX, JSON.stringify(entry) + '\n')
    console.log(`appended ${id}: ${wall}s${tokens !== undefined ? `, ${tokens} tokens` : ''}, ${entry.artifact_count} artifacts, ${entry.escalations} escalations`)
    break
  }

  case 'list': {
    const rows = readIndex()
    if (opts.json) { console.log(JSON.stringify(rows, null, 2)); break }
    if (!rows.length) { console.log('ledger is empty'); break }
    for (const r of rows) console.log(`${r.id}\t${r.status}\t${r.provenance.method}\t${r.wall_clock_sec}s\t${r.tokens ?? '?'} tok\t${r.artifact_count} artifacts\t${r.escalations} esc`)
    break
  }

  case 'show': {
    if (!a) die('usage: ledger show <run_id>')
    const hits = fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter(f => f.startsWith(safe(a) + '-')) : []
    if (!hits.length) die(`no ledger runs for ${a}`, 1)
    for (const f of hits) console.log(JSON.stringify(readJson(path.join(RUNS, f)), null, 2))
    break
  }

  case 'summary': {
    // Method Ledger. Run-level tokens/wall clock are attributed to the run's own provenance.method.
    // Per-node rows come from nested artifacts' provenance (node, method, tokens when a script stamped them).
    const by = opts.by ?? 'method'
    if (!['method', 'workflow', 'node'].includes(by)) die('--by must be method, workflow, or node')
    const rows = readIndex()
    const groups = {}
    const add = (k, f) => { const g = groups[k] ??= { key: k, runs: 0, artifacts: 0, tokens: 0, wall_clock_sec: 0, human_min: 0, escalations: 0 }; f(g) }
    for (const r of rows) {
      if (by === 'node') {
        const { result } = readJson(path.join(RUNS, `${r.id}.json`))
        for (const p of artifacts(result)) add(`${p.node} [${p.method}]`, g => { g.artifacts++; g.tokens += p.tokens ?? 0 })
        continue
      }
      const key = by === 'method' ? r.provenance.method : r.workflow
      add(key, g => { g.runs++; g.artifacts += r.artifact_count; g.tokens += r.tokens ?? 0; g.wall_clock_sec += r.wall_clock_sec; g.human_min += r.human_min ?? 0; g.escalations += r.escalations })
    }
    const out = Object.values(groups).sort((x, y) => y.tokens - x.tokens)
    if (opts.json) { console.log(JSON.stringify(out, null, 2)); break }
    if (!out.length) { console.log('ledger is empty'); break }
    const cols = by === 'node' ? ['key', 'artifacts', 'tokens'] : ['key', 'runs', 'artifacts', 'tokens', 'wall_clock_sec', 'human_min', 'escalations']
    console.log(cols.join('\t'))
    for (const g of out) console.log(cols.map(c => g[c]).join('\t'))
    break
  }

  default:
    die('usage: ledger append|list|show|summary ...  (see header of substrate/ledger.js)')
}
