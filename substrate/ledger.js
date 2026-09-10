#!/usr/bin/env node
// Run trace + Method Ledger. Every workflow return is appended here with provenance, tokens, wall clock.
// The script cannot see its own tokens or a clock, so this runs AFTER the workflow returns, from the main session.
//
//   ledger append --workflow <name> --run <run_id> --started <iso> --result <file.json>
//                 [--tokens N] [--tokens-by-model '{"claude-opus-5":N,...}'] [--agents N] [--human-min N] [--status ok|failed] [--journal <path>] [--now <iso>]
//   ledger recost [<id>]            recompute cost_est_usd from substrate/lib/pricing.json (all rows, or one)
//   ledger list [--json]
//   ledger summary [--by method|workflow|node|model] [--json]
//   ledger show <run_id>
import fs from 'node:fs'
import path from 'node:path'
import { ARTIFACTS, LEDGER, ensureDir, absToRef, parseArgs, die, readJson, writeJson, nowIso } from './lib/paths.js'
import { validate, formatErrors } from './lib/contracts.js'
import { estimateCost, normalizeMap } from './lib/pricing.js'

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
    if (opts['tokens-by-model']) {
      let map; try { map = JSON.parse(opts['tokens-by-model']) } catch { die('--tokens-by-model must be a JSON object of model → integer tokens') }
      entry.tokens_by_model = normalizeMap(map)
      if (entry.tokens === undefined) entry.tokens = Object.values(entry.tokens_by_model).reduce((a, b) => a + b, 0)
      const c = estimateCost(entry.tokens_by_model); entry.cost_est_usd = c.cost_est_usd
      if (c.unpriced.length) process.stderr.write(`warning: no price for ${c.unpriced.join(', ')}; excluded from cost_est_usd\n`)
    }
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
    const costTxt = entry.cost_est_usd !== undefined ? `, ~$` + entry.cost_est_usd.toFixed(2) : ''
    console.log(`appended ${id}: ${wall}s${entry.tokens !== undefined ? `, ${entry.tokens} tokens` : ''}${costTxt}, ${entry.artifact_count} artifacts, ${entry.escalations} escalations`)
    break
  }

  case 'recost': {
    const rows = readIndex()
    let n = 0
    for (const r of rows) {
      if (a && r.id !== a) continue
      if (!r.tokens_by_model) continue
      r.cost_est_usd = estimateCost(r.tokens_by_model).cost_est_usd; n++
      const p = path.join(RUNS, `${r.id}.json`); const doc = readJson(p); doc.entry = r; writeJson(p, doc)
    }
    fs.writeFileSync(INDEX, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    console.log(`recosted ${n} row(s) from substrate/lib/pricing.json`)
    break
  }

  case 'list': {
    const rows = readIndex()
    if (opts.json) { console.log(JSON.stringify(rows, null, 2)); break }
    if (!rows.length) { console.log('ledger is empty'); break }
    const usd = (r) => r.cost_est_usd !== undefined ? '$' + r.cost_est_usd.toFixed(2) : '$?'
    for (const r of rows) console.log(`${r.id}\t${r.status}\t${r.provenance.method}\t${r.wall_clock_sec}s\t${r.tokens ?? '?'} tok\t${usd(r)}\t${r.artifact_count} artifacts\t${r.escalations} esc`)
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
    if (!['method', 'workflow', 'node', 'model'].includes(by)) die('--by must be method, workflow, node, or model')
    const rows = readIndex()
    const groups = {}
    const add = (k, f) => { const g = groups[k] ??= { key: k, runs: 0, artifacts: 0, tokens: 0, cost_est_usd: 0, wall_clock_sec: 0, human_min: 0, escalations: 0 }; f(g) }
    for (const r of rows) {
      if (by === 'model') {
        for (const [m, t] of Object.entries(r.tokens_by_model ?? {})) add(m, g => { g.runs++; g.tokens += t; g.cost_est_usd += estimateCost({ [m]: t }).cost_est_usd })
        continue
      }
      if (by === 'node') {
        const { result } = readJson(path.join(RUNS, `${r.id}.json`))
        for (const p of artifacts(result)) add(`${p.node} [${p.method}]`, g => { g.artifacts++; g.tokens += p.tokens ?? 0 })
        continue
      }
      const key = by === 'method' ? r.provenance.method : r.workflow
      add(key, g => { g.runs++; g.artifacts += r.artifact_count; g.tokens += r.tokens ?? 0; g.cost_est_usd += r.cost_est_usd ?? 0; g.wall_clock_sec += r.wall_clock_sec; g.human_min += r.human_min ?? 0; g.escalations += r.escalations })
    }
    const out = Object.values(groups).map(g => ({ ...g, cost_est_usd: Math.round(g.cost_est_usd * 100) / 100 })).sort((x, y) => y.tokens - x.tokens)
    if (opts.json) { console.log(JSON.stringify(out, null, 2)); break }
    if (!out.length) { console.log('ledger is empty'); break }
    const cols = by === 'node' ? ['key', 'artifacts', 'tokens'] : by === 'model' ? ['key', 'runs', 'tokens', 'cost_est_usd'] : ['key', 'runs', 'artifacts', 'tokens', 'cost_est_usd', 'wall_clock_sec', 'human_min', 'escalations']
    console.log(cols.join('\t'))
    for (const g of out) console.log(cols.map(c => g[c]).join('\t'))
    break
  }

  default:
    die('usage: ledger append|list|show|summary|recost ...  (see header of substrate/ledger.js)')
}
