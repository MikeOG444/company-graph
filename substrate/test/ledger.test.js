import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot, FIX } from './helpers.js'

test('append validates a LedgerEntry, stores the result, copies the journal, and summarizes by method', () => {
  const root = tmpRoot()
  const journal = path.join(root, 'journal.jsonl')
  fs.writeFileSync(journal, '{"agent":"planner","result":{}}\n')
  const bundle = path.join(FIX, 'evidence-bundle.valid.json')

  const r = cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r1', '--started', '2026-09-10T10:00:00Z',
    '--result', bundle, '--tokens', '48000', '--agents', '9', '--journal', journal, '--now', '2026-09-10T10:09:30Z'], { root })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /appended r1-build-implement: 570s, 48000 tokens, 2 artifacts, 0 escalations/)

  const entry = JSON.parse(fs.readFileSync(path.join(root, 'ledger', 'index.jsonl'), 'utf8').trim())
  assert.equal(entry.wall_clock_sec, 570)
  assert.equal(entry.provenance.method, 'hotl')
  assert.equal(entry.trace_ref, '.artifacts/traces/r1-build-implement.jsonl')
  assert.ok(fs.existsSync(path.join(root, entry.trace_ref)))
  assert.ok(fs.existsSync(path.join(root, entry.result_ref)))
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(entry) }).code, 0)

  // Same run_id + workflow again is refused.
  assert.equal(cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r1', '--started', '2026-09-10T10:00:00Z', '--result', bundle], { root }).code, 1)

  // A second run under a different method.
  const spec = path.join(root, 'spec-out.json')
  fs.writeFileSync(spec, JSON.stringify({ ready: [], gated: [], provenance: { node: 'build-spec', executor: 'ai_agent', method: 'dark_factory', run_id: 'r2', created_at: '2026-09-10T10:00:00Z' } }))
  assert.equal(cli('ledger', ['append', '--workflow', 'build-spec', '--run', 'r2', '--started', '2026-09-10T12:00:00Z', '--result', spec, '--tokens', '2000', '--now', '2026-09-10T12:01:00Z'], { root }).code, 0)

  const byMethod = JSON.parse(cli('ledger', ['summary', '--by', 'method', '--json'], { root }).out)
  assert.deepEqual(byMethod.map(g => [g.key, g.runs, g.tokens, g.wall_clock_sec]), [['hotl', 1, 48000, 570], ['dark_factory', 1, 2000, 60]])

  const byNode = JSON.parse(cli('ledger', ['summary', '--by', 'node', '--json'], { root }).out)
  assert.ok(byNode.some(g => g.key === 'lens:security [dark_factory]' && g.tokens === 1200), JSON.stringify(byNode))

  assert.equal(cli('ledger', ['append', '--workflow', 'x', '--run', 'r3', '--started', '2026-09-10T12:00:00Z', '--result', spec, '--tokens', '-1'], { root }).code, 2)
})

test('tokens-by-model prices each model separately; recost follows pricing.json; summary --by model', () => {
  const root = tmpRoot()
  const spec = path.join(root, 'r.json')
  fs.writeFileSync(spec, JSON.stringify({ provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'r9', created_at: '2026-09-10T10:00:00Z' } }))
  const r = cli('ledger', ['append', '--workflow', 'w', '--run', 'r9', '--started', '2026-09-10T10:00:00Z', '--result', spec, '--now', '2026-09-10T10:01:00Z',
    '--tokens-by-model', JSON.stringify({ 'claude-opus-5[1m]': 1000000, 'claude-haiku-4-5-20251001': 1000000 })], { root })
  assert.equal(r.code, 0, r.err)
  const entry = JSON.parse(fs.readFileSync(path.join(root, 'ledger', 'index.jsonl'), 'utf8').trim())
  assert.deepEqual(entry.tokens_by_model, { 'claude-opus-5': 1000000, 'claude-haiku-4-5': 1000000 })
  assert.equal(entry.tokens, 2000000)
  // opus: 0.9*5 + 0.1*25 = 7.00 per M; haiku: 0.9*1 + 0.1*5 = 1.40 per M
  assert.equal(entry.cost_est_usd, 8.4)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(entry) }).code, 0)
  const byModel = JSON.parse(cli('ledger', ['summary', '--by', 'model', '--json'], { root }).out)
  assert.deepEqual(byModel.map(g => [g.key, g.cost_est_usd]).sort(), [['claude-haiku-4-5', 1.4], ['claude-opus-5', 7]])
  assert.match(cli('ledger', ['recost'], { root }).out, /recosted 1 row/)
})

// --from-output: derives everything from a Workflow task output file. Expected numbers for
// fixtures/task-output.valid.json, worked by hand from its workflowProgress entries:
//   started_at = min(queuedAt/startedAt) = 1757563200000 -> 2025-09-11T04:00:00.000Z
//   finished_at = max(lastProgressAt, startedAt+durationMs) = 1757563660000 -> 2025-09-11T04:07:40.000Z
//   wall_clock_sec = 460; tokens_by_model = {claude-sonnet-5: 48000, claude-haiku-4-5: 4000}; tokens = 52000
//   cost: sonnet 48000/1e6*2.8 = 0.1344, haiku 4000/1e6*1.4 = 0.0056, total 0.14
const VALID_OUTPUT = path.join(FIX, 'task-output.valid.json')
const ZERO_WALL_OUTPUT = path.join(FIX, 'task-output.zero-wall.json')

function readIndexRows(root) {
  const p = path.join(root, 'ledger', 'index.jsonl')
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}
function runsDirListing(root) {
  const d = path.join(root, 'ledger', 'runs')
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : []
}

test('--from-output derives agents, tokens_by_model, tokens, timestamps and result; stdout carries the per-model split (AC-1, AC-6)', () => {
  const root = tmpRoot()
  const r = cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r5', '--from-output', VALID_OUTPUT], { root })
  assert.equal(r.code, 0, r.err)
  const lines = r.out.split('\n')
  assert.match(lines[0], /^appended r5-build-implement: 460s, 52000 tokens, ~\$0\.14, 1 artifacts, 0 escalations$/)
  // per-model split ordered by cost descending: sonnet (0.13) before haiku (0.01)
  assert.equal(lines.length, 3)
  assert.match(lines[1], /^  claude-sonnet-5: 48000 tokens, \$0\.13/)
  assert.match(lines[2], /^  claude-haiku-4-5: 4000 tokens, \$0\.01/)

  const entry = readIndexRows(root)[0]
  assert.equal(entry.agents, 3)
  assert.deepEqual(entry.tokens_by_model, { 'claude-sonnet-5': 48000, 'claude-haiku-4-5': 4000 })
  assert.equal(entry.tokens, 52000)
  assert.equal(entry.cost_est_usd, 0.14)
  assert.equal(entry.started_at, '2025-09-11T04:00:00.000Z')
  assert.equal(entry.finished_at, '2025-09-11T04:07:40.000Z')
  assert.equal(entry.wall_clock_sec, 460)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(entry) }).code, 0)

  const doc = JSON.parse(fs.readFileSync(VALID_OUTPUT, 'utf8'))
  const stored = JSON.parse(fs.readFileSync(path.join(root, entry.result_ref), 'utf8'))
  assert.deepEqual(stored.result, doc.result)
})

test('--from-output: explicit flags override the derived value; the rest still comes from the file (AC-2)', () => {
  const root = tmpRoot()
  const overrideResult = path.join(root, 'override-result.json')
  fs.writeFileSync(overrideResult, JSON.stringify({ provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'r6', created_at: '2026-01-01T00:00:00Z' } }))

  const r = cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r6', '--from-output', VALID_OUTPUT,
    '--started', '2026-01-01T00:00:00Z', '--now', '2026-01-01T00:10:00Z', '--agents', '99', '--tokens', '1', '--result', overrideResult], { root })
  assert.equal(r.code, 0, r.err)
  const entry = readIndexRows(root)[0]
  assert.equal(entry.started_at, '2026-01-01T00:00:00.000Z')
  assert.equal(entry.finished_at, '2026-01-01T00:10:00.000Z')
  assert.equal(entry.wall_clock_sec, 600)
  assert.equal(entry.agents, 99)
  assert.equal(entry.tokens, 1)
  // tokens_by_model was not overridden, so it still comes from the output file.
  assert.deepEqual(entry.tokens_by_model, { 'claude-sonnet-5': 48000, 'claude-haiku-4-5': 4000 })
  const stored = JSON.parse(fs.readFileSync(path.join(root, entry.result_ref), 'utf8'))
  assert.equal(stored.result.provenance.run_id, 'r6')
})

test('--from-output refuses (exit 2, nothing written) when timestamps are equal or unusable beside non-zero tokens (AC-3)', () => {
  const root = tmpRoot()
  const equalTimestamps = path.join(root, 'equal.json')
  fs.writeFileSync(equalTimestamps, JSON.stringify({
    workflowProgress: [{ type: 'workflow_agent', model: 'claude-sonnet-5', tokens: 5000, queuedAt: 1700000000000, startedAt: 1700000000000, lastProgressAt: 1700000000000 }],
    result: { provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'r7', created_at: '2026-01-01T00:00:00Z' } },
  }))
  const beforeIndex = readIndexRows(root), beforeRuns = runsDirListing(root)
  const r1 = cli('ledger', ['append', '--workflow', 'w', '--run', 'r7', '--from-output', equalTimestamps], { root })
  assert.equal(r1.code, 2)
  assert.match(r1.err, /started_at/)
  assert.match(r1.err, /finished_at|wall_clock/)
  assert.match(r1.err, /5000/)
  assert.deepEqual(readIndexRows(root), beforeIndex)
  assert.deepEqual(runsDirListing(root), beforeRuns)

  const noTimestamps = path.join(root, 'no-timestamps.json')
  fs.writeFileSync(noTimestamps, JSON.stringify({
    workflowProgress: [{ type: 'workflow_agent', model: 'claude-sonnet-5', tokens: 5000 }],
    result: { provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'r8', created_at: '2026-01-01T00:00:00Z' } },
  }))
  const r2 = cli('ledger', ['append', '--workflow', 'w', '--run', 'r8', '--from-output', noTimestamps], { root })
  assert.equal(r2.code, 2)
  assert.deepEqual(readIndexRows(root), beforeIndex)
  assert.deepEqual(runsDirListing(root), beforeRuns)
})

test('append refuses (exit 2, nothing written) when --started is after --now, without clamping to 0 (AC-4, the m2 regression)', () => {
  const root = tmpRoot()
  const spec = path.join(root, 'spec.json')
  fs.writeFileSync(spec, JSON.stringify({ provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'm2', created_at: '2026-09-11T03:36:00Z' } }))
  const beforeIndex = readIndexRows(root), beforeRuns = runsDirListing(root)
  const r = cli('ledger', ['append', '--workflow', 'maintain-triage', '--run', 'm2', '--started', '2026-09-11T03:36:00Z',
    '--now', '2026-09-11T03:33:58.960Z', '--tokens', '338559', '--result', spec], { root })
  assert.equal(r.code, 2)
  assert.match(r.err, /before/)
  assert.match(r.err, /2026-09-11T03:36:00/)
  assert.match(r.err, /2026-09-11T03:33:58\.960/)
  assert.deepEqual(readIndexRows(root), beforeIndex)
  assert.deepEqual(runsDirListing(root), beforeRuns)
})

test('--from-output succeeds with wall_clock_sec 0 for a legitimately tokenless, near-instantaneous run (AC-5)', () => {
  const root = tmpRoot()
  const r = cli('ledger', ['append', '--workflow', 'mechanical', '--run', 'rzw', '--from-output', ZERO_WALL_OUTPUT], { root })
  assert.equal(r.code, 0, r.err)
  const entry = readIndexRows(root)[0]
  assert.equal(entry.wall_clock_sec, 0)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(entry) }).code, 0)
})

test('--from-output exits 2 naming the problem for an unreadable/invalid/agent-less output file, writing nothing (AC-8)', () => {
  const root = tmpRoot()
  const cases = {
    missing: path.join(root, 'does-not-exist.json'),
    empty: path.join(root, 'empty.json'),
    text: path.join(root, 'plain.txt'),
    noProgress: path.join(root, 'no-progress.json'),
    noAgents: path.join(root, 'no-agents.json'),
  }
  fs.writeFileSync(cases.empty, '')
  fs.writeFileSync(cases.text, 'this is not json')
  fs.writeFileSync(cases.noProgress, JSON.stringify({ result: {} }))
  fs.writeFileSync(cases.noAgents, JSON.stringify({ workflowProgress: [{ type: 'workflow_status' }], result: {} }))

  for (const [name, file] of Object.entries(cases)) {
    const r = cli('ledger', ['append', '--workflow', 'w', '--run', `bad-${name}`, '--from-output', file], { root })
    assert.equal(r.code, 2, `${name}: ${r.out}${r.err}`)
    assert.match(r.err, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), name)
  }
  assert.deepEqual(readIndexRows(root), [])
  assert.deepEqual(runsDirListing(root), [])
})

test('--from-output with no doc.result requires --result; passing it succeeds (AC-9)', () => {
  const root = tmpRoot()
  const noResult = path.join(root, 'no-result.json')
  fs.writeFileSync(noResult, JSON.stringify({ workflowProgress: [{ type: 'workflow_agent', model: 'claude-sonnet-5', tokens: 100, queuedAt: 1700000000000, lastProgressAt: 1700000005000 }] }))
  const r1 = cli('ledger', ['append', '--workflow', 'w', '--run', 'r9a', '--from-output', noResult], { root })
  assert.equal(r1.code, 2)
  assert.match(r1.err, /no run result|--result/)
  assert.deepEqual(readIndexRows(root), [])

  const resultFile = path.join(root, 'result.json')
  fs.writeFileSync(resultFile, JSON.stringify({ provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'r9b', created_at: '2026-01-01T00:00:00Z' } }))
  const r2 = cli('ledger', ['append', '--workflow', 'w', '--run', 'r9b', '--from-output', noResult, '--result', resultFile], { root })
  assert.equal(r2.code, 0, r2.err)
})

test('--from-output plays with --journal/--status/--human-min exactly as before (AC-15)', () => {
  const root = tmpRoot()
  const journal = path.join(root, 'journal.jsonl')
  fs.writeFileSync(journal, '{"agent":"mechanical","result":{}}\n')
  const r = cli('ledger', ['append', '--workflow', 'mechanical', '--run', 'r10', '--from-output', VALID_OUTPUT,
    '--journal', journal, '--status', 'failed', '--human-min', '5'], { root })
  assert.equal(r.code, 0, r.err)
  const entry = readIndexRows(root)[0]
  assert.equal(entry.status, 'failed')
  assert.equal(entry.human_min, 5)
  assert.equal(entry.trace_ref, '.artifacts/traces/r10-mechanical.jsonl')
  assert.ok(fs.existsSync(path.join(root, entry.trace_ref)))

  const r2 = cli('ledger', ['append', '--workflow', 'mechanical', '--run', 'r11', '--from-output', VALID_OUTPUT, '--journal', path.join(root, 'no-such-journal.jsonl')], { root })
  assert.equal(r2.code, 2)
})

test('a row marked wall_clock_unknown is excluded from the summary wall-clock total and counted in wall_unknown_runs (AC-13); list renders it as ?s (AC-14)', () => {
  const root = tmpRoot()
  const bundle = path.join(FIX, 'evidence-bundle.valid.json')
  assert.equal(cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'ra', '--started', '2026-01-01T00:00:00Z',
    '--result', bundle, '--tokens', '1000', '--now', '2026-01-01T00:01:00Z'], { root }).code, 0)
  assert.equal(cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'rb', '--started', '2026-01-01T00:00:00Z',
    '--result', bundle, '--tokens', '2000', '--now', '2026-01-01T00:02:00Z'], { root }).code, 0)

  // Mark the second row as wall_clock_unknown, as if its start time were unrecoverable, and rewrite the index.
  const rows = readIndexRows(root)
  const marked = rows.find(r => r.run_id === 'rb')
  marked.wall_clock_unknown = true
  fs.writeFileSync(path.join(root, 'ledger', 'index.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(marked) }).code, 0)

  const byMethod = JSON.parse(cli('ledger', ['summary', '--by', 'method', '--json'], { root }).out)
  const hotl = byMethod.find(g => g.key === 'hotl')
  assert.equal(hotl.runs, 2)
  assert.equal(hotl.tokens, 3000)
  assert.equal(hotl.wall_clock_sec, 60)   // only ra's 60s; rb's 120s is excluded
  assert.equal(hotl.wall_unknown_runs, 1)

  const list = cli('ledger', ['list'], { root }).out.split('\n')
  assert.ok(list.some(l => l.startsWith('rb-build-implement\t') && l.includes('\t?s\t')), list.join('\n'))
  const jsonRows = JSON.parse(cli('ledger', ['list', '--json'], { root }).out)
  assert.equal(jsonRows.find(r => r.id === 'rb-build-implement').wall_clock_unknown, true)
})
