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
