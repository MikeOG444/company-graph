// AC-9: recost's row count includes every row recomputed (that matches the optional id filter and carries
// tokens_by_model), whether or not the recomputed value differs from what was already stored — the
// substrate/test/ledger.test.js:58 scenario. Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun, loadPricing } from './k23-helpers.js'

test('AC-9: recost reports "recosted 1 row" for a row whose recomputed cost equals the cost already stored', async () => {
  const { estimateCost } = await loadPricing()
  const root = tmpRoot()
  const tokensByModel = { 'claude-opus-5[1m]': 1000000, 'claude-haiku-4-5-20251001': 1000000 }
  const alreadyCorrect = estimateCost(tokensByModel).cost_est_usd

  const row = makeEntry({ id: 'e1-w', run_id: 'e1', workflow: 'w', tokens_by_model: tokensByModel, tokens: 2000000, cost_est_usd: alreadyCorrect })
  writeIndex(root, [row])
  writeRun(root, 'e1-w', { ...row }, {})

  const r = cli('ledger', ['recost'], { root })
  assert.match(r.out, /recosted 1 row/)
})
