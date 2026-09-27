// AC-6: `ledger check` compares each index row against its run-file entry, ignoring cost_est_usd, and fails
// loudly (exit 1) naming the disagreeing row id and field for each offending row — and only those rows.
// Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun } from './k23-helpers.js'

test('AC-6: check exits 1 and names each offending row id and field, leaving the consistent row unmentioned', () => {
  const root = tmpRoot()

  const rowA = makeEntry({ id: 'r1-w', run_id: 'r1', workflow: 'w', tokens: 100 })
  const rowB = makeEntry({ id: 'r2-w', run_id: 'r2', workflow: 'w', tokens: 200 })
  const rowC = makeEntry({ id: 'r3-w', run_id: 'r3', workflow: 'w', tokens: 300 })
  writeIndex(root, [rowA, rowB, rowC])

  // r1: run-file entry disagrees on `tokens`.
  writeRun(root, 'r1-w', { ...rowA, tokens: 999 }, {})
  // r2: run-file entry carries wall_clock_unknown: true that the index row lacks.
  writeRun(root, 'r2-w', { ...rowB, wall_clock_unknown: true }, {})
  // r3: fully consistent.
  writeRun(root, 'r3-w', { ...rowC }, {})

  const r = cli('ledger', ['check'], { root })
  assert.equal(r.code, 1)

  const combined = `${r.out}\n${r.err}`
  const lines = combined.split('\n')

  const r1Line = lines.find(l => l.includes('r1-w'))
  assert.ok(r1Line, `expected a line naming r1-w in:\n${combined}`)
  assert.match(r1Line, /tokens/)

  const r2Line = lines.find(l => l.includes('r2-w'))
  assert.ok(r2Line, `expected a line naming r2-w in:\n${combined}`)
  assert.match(r2Line, /wall_clock_unknown/)

  assert.ok(!lines.some(l => l.includes('r3-w')), `r3-w (consistent) must not appear on any failure line:\n${combined}`)
})
