// AC-3: for a row with no index/run-file drift, recost changes cost_est_usd (and nothing else) identically
// in both the index line and the run file's entry, to estimateCost(row.tokens_by_model).cost_est_usd.
// Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun, readIndexRows, readRun, loadPricing, assertOnlyFieldChanged } from './k23-helpers.js'

test('AC-3: recost recomputes a stale cost_est_usd identically on the index row and the run-file entry', async () => {
  const { estimateCost } = await loadPricing()
  const root = tmpRoot()

  const tokensByModel = { 'claude-haiku-4-5': 200000 }
  const entryBefore = makeEntry({ id: 'k2-y', run_id: 'k2', workflow: 'y', tokens_by_model: tokensByModel, tokens: 200000, cost_est_usd: 0.1 })
  writeIndex(root, [entryBefore])
  writeRun(root, 'k2-y', entryBefore, { some: 'result' })

  const r = cli('ledger', ['recost'], { root })
  assert.equal(r.code, 0, r.err)

  const expected = estimateCost(tokensByModel).cost_est_usd
  assert.notEqual(expected, 0.1, 'test fixture must actually be stale')

  const indexRowAfter = readIndexRows(root).find(x => x.id === 'k2-y')
  assertOnlyFieldChanged(assert, entryBefore, indexRowAfter, 'cost_est_usd')
  assert.equal(indexRowAfter.cost_est_usd, expected)

  const runEntryAfter = readRun(root, 'k2-y').entry
  assertOnlyFieldChanged(assert, entryBefore, runEntryAfter, 'cost_est_usd')
  assert.equal(runEntryAfter.cost_est_usd, expected)

  assert.equal(indexRowAfter.cost_est_usd, runEntryAfter.cost_est_usd, 'both copies carry the same recomputed number')
})
