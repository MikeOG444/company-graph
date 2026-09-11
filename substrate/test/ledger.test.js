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
