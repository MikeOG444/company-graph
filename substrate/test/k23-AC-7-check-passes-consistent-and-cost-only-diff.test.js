// AC-7: `ledger check` exits 0 both when every pair matches exactly, and when a pair differs ONLY in
// cost_est_usd (the mid-recost state) — cost_est_usd is explicitly ignored by the comparison.
// Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun } from './k23-helpers.js'

test('AC-7: check exits 0 when rows fully agree, and also when they differ only in cost_est_usd', () => {
  // (a) every index row and its run-file entry are identical.
  const rootA = tmpRoot()
  const rowA = makeEntry({ id: 'a1-w', run_id: 'a1', workflow: 'w', tokens_by_model: { 'claude-sonnet-5': 1000 }, tokens: 1000, cost_est_usd: 0.003 })
  writeIndex(rootA, [rowA])
  writeRun(rootA, 'a1-w', { ...rowA }, {})
  const ra = cli('ledger', ['check'], { root: rootA })
  assert.equal(ra.code, 0, `${ra.out}\n${ra.err}`)

  // (b) one pair differs ONLY in cost_est_usd — the mid-recost state.
  const rootB = tmpRoot()
  const rowB = makeEntry({ id: 'b1-w', run_id: 'b1', workflow: 'w', tokens_by_model: { 'claude-sonnet-5': 1000 }, tokens: 1000, cost_est_usd: 0.5 })
  writeIndex(rootB, [rowB])
  writeRun(rootB, 'b1-w', { ...rowB, cost_est_usd: 0.9 }, {})
  const rb = cli('ledger', ['check'], { root: rootB })
  assert.equal(rb.code, 0, `${rb.out}\n${rb.err}`)
})
