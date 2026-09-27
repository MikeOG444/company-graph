// AC-8: `recost` runs the same consistency check at the end of its work. When a row's run-file entry
// disagrees with its index row on a field other than cost_est_usd, recost still prints its
// `recosted N row(s)` line, also prints the disagreement (naming the row and field), and exits non-zero.
// When every pair agrees, recost exits 0 and prints no disagreement. Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun } from './k23-helpers.js'

test('AC-8: recost surfaces a non-cost disagreement (exit non-zero) but stays silent and exits 0 when consistent', () => {
  // Case 1: the run-file entry disagrees with its index row on `status` (not cost_est_usd).
  const root1 = tmpRoot()
  const row1 = makeEntry({ id: 'd1-w', run_id: 'd1', workflow: 'w', tokens_by_model: { 'claude-sonnet-5': 100000 }, tokens: 100000, cost_est_usd: 0.28, status: 'ok' })
  writeIndex(root1, [row1])
  writeRun(root1, 'd1-w', { ...row1, status: 'failed' }, {})

  const r1 = cli('ledger', ['recost'], { root: root1 })
  assert.match(r1.out, /recosted \d+ row/, 'the recosted N row(s) line must still print')
  const combined1 = `${r1.out}\n${r1.err}`
  const offendingLine = combined1.split('\n').find(l => l.includes('d1-w'))
  assert.ok(offendingLine, `expected a line naming d1-w in:\n${combined1}`)
  assert.match(offendingLine, /status/)
  assert.notEqual(r1.code, 0, 'recost must exit non-zero when a disagreement is found')

  // Case 2: fully consistent — recost exits 0 and names no row.
  const root2 = tmpRoot()
  const row2 = makeEntry({ id: 'd2-w', run_id: 'd2', workflow: 'w', tokens_by_model: { 'claude-sonnet-5': 100000 }, tokens: 100000, cost_est_usd: 0.28, status: 'ok' })
  writeIndex(root2, [row2])
  writeRun(root2, 'd2-w', { ...row2 }, {})

  const r2 = cli('ledger', ['recost'], { root: root2 })
  assert.equal(r2.code, 0, `${r2.out}\n${r2.err}`)
  assert.ok(!r2.out.includes('d2-w') && !r2.err.includes('d2-w'), 'no disagreement line should name a consistent row')
})
