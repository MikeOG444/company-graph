#!/usr/bin/env node
// Gate queue. A workflow's output that needs a human decision is written to gates/open/ as a GateRecord
// (contracts.schema.json). The human decides in chat; `gates decide` records it and moves the file to gates/closed/.
//
//   gates open --gate <name> --run <run_id> --workflow <name> --options a,b,c
//              [--payload <file.json> | --payload-ref <ref>] [--project <id>] [--next <workflow>] [--now <iso>]
//   gates list [--open | --closed | --all] [--stale <hours>] [--json]
//   gates show <id>
//   gates decide <id> <option> [--note "..."] [--select <id,id,...>] [--now <iso>]
//     --select records decision.selection: the ids the human picked when the decision is more than one word
//     (the roadmap_gate's approved Opportunity ids, with the VentureVerdict in <option>).
import fs from 'node:fs'
import path from 'node:path'
import { GATES, ensureDir, parseArgs, die, readJson, writeJson, nowIso } from './lib/paths.js'
import { validate, formatErrors } from './lib/contracts.js'

const OPEN = path.join(GATES, 'open'), CLOSED = path.join(GATES, 'closed')
const { pos, opts } = parseArgs(process.argv.slice(2))
const [cmd, a, b] = pos

const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_')
function locate(id) {
  for (const dir of [OPEN, CLOSED]) {
    const p = path.join(dir, `${id}.json`)
    if (fs.existsSync(p)) return p
  }
  die(`no gate with id ${id}`, 1)
}
function listDir(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir, f)))
}
function assertValid(rec) {
  const r = validate('GateRecord', rec)
  if (!r.ok) die(`GateRecord invalid:\n${formatErrors(r.errors)}`)
}

switch (cmd) {
  case 'open': {
    const { gate, run, workflow, options } = opts
    if (!gate || !run || !workflow || !options) die('usage: gates open --gate <name> --run <run_id> --workflow <name> --options a,b,c [--payload f | --payload-ref ref] [--project id] [--next workflow] [--now iso]')
    ensureDir(OPEN); ensureDir(CLOSED)
    const base = `${safe(run)}-${safe(gate)}`
    let id = base
    for (let n = 2; fs.existsSync(path.join(OPEN, `${id}.json`)) || fs.existsSync(path.join(CLOSED, `${id}.json`)); n++) id = `${base}-${n}`
    const opened_at = nowIso(opts.now)
    const rec = {
      id, gate, run_id: run, workflow, status: 'open', opened_at,
      options: String(options).split(',').map(s => s.trim()).filter(Boolean),
      provenance: { node: gate, executor: 'ai_agent', method: 'hitl', run_id: run, created_at: opened_at },
    }
    if (opts.project) rec.project_id = opts.project
    if (opts.next) rec.next_workflow = opts.next
    if (opts['payload-ref']) rec.payload_ref = opts['payload-ref']
    if (opts.payload) rec.payload = readJson(opts.payload)
    assertValid(rec)
    writeJson(path.join(OPEN, `${id}.json`), rec)
    console.log(id)
    break
  }

  case 'list': {
    const which = opts.closed ? [CLOSED] : opts.all ? [OPEN, CLOSED] : [OPEN]
    let recs = which.flatMap(listDir)
    if (opts.stale) {
      const cutoff = Date.now() - Number(opts.stale) * 3600 * 1000
      recs = recs.filter(r => r.status === 'open' && Date.parse(r.opened_at) < cutoff)
    }
    recs.sort((x, y) => x.opened_at.localeCompare(y.opened_at))
    if (opts.json) { console.log(JSON.stringify(recs, null, 2)); break }
    if (!recs.length) { console.log(opts.stale ? 'no stale gates' : 'no open gates'); break }
    for (const r of recs) {
      const dec = r.decision ? ` → ${r.decision.option}` : ''
      console.log(`${r.id}\t${r.status}\t${r.gate}\t${r.workflow}\t${r.opened_at}\toptions: ${r.options.join('|')}${dec}`)
    }
    break
  }

  case 'show': {
    if (!a) die('usage: gates show <id>')
    console.log(JSON.stringify(readJson(locate(a)), null, 2))
    break
  }

  case 'decide': {
    if (!a || !b) die('usage: gates decide <id> <option> [--note "..."] [--select id,id,...] [--now iso]')
    const p = locate(a)
    const rec = readJson(p)
    if (rec.status !== 'open') die(`gate ${a} is already ${rec.status} (${rec.decision?.option})`, 1)
    if (!rec.options.includes(b)) die(`"${b}" is not an option for ${a}. Options: ${rec.options.join(', ')}`, 1)
    rec.status = 'decided'
    rec.decision = { option: b, decided_by: 'human_employee', decided_at: nowIso(opts.now) }
    if (opts.note && opts.note !== true) rec.decision.note = String(opts.note)
    // Some decisions are more than one word: the roadmap_gate carries the VentureVerdict in `option` and the
    // approved Opportunity ids here. Structured, so the next workflow reads a list instead of parsing the note.
    if (opts.select && opts.select !== true) {
      rec.decision.selection = String(opts.select).split(',').map(x => x.trim()).filter(Boolean)
    }
    assertValid(rec)
    ensureDir(CLOSED)
    writeJson(path.join(CLOSED, `${rec.id}.json`), rec)
    fs.rmSync(p)
    // What the next workflow needs in args: the decision, keyed by gate and run.
    const argsHint = { gate: rec.gate, gate_id: rec.id, run_id: rec.run_id, decision: b }
    if (rec.decision.note) argsHint.note = rec.decision.note
    if (rec.decision.selection) argsHint.selection = rec.decision.selection
    console.log(`decided ${rec.id}: ${b}`)
    if (rec.next_workflow) console.log(`next: /${rec.next_workflow} with args including ${JSON.stringify(argsHint)}`)
    else console.log(`args for the next workflow: ${JSON.stringify(argsHint)}`)
    break
  }

  default:
    die('usage: gates open|list|show|decide ...  (see header of substrate/gates.js)')
}
