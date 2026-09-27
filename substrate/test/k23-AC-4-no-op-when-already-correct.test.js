// AC-4: when every row's index cost_est_usd and run-file entry cost_est_usd already equal the recomputed
// value, and the index and run-file entries agree on every other field, `recost` exits 0 and makes no write
// at all -- ledger/index.jsonl and every file under ledger/runs/ are byte-identical to before. Written from
// the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cli, tmpRoot } from './helpers.js'
import { indexPath, runPath, makeEntry, writeIndex, writeRun, loadPricing } from './k23-helpers.js'

test('AC-4: recost makes no write at all when every row is already fully consistent and correctly costed', async () => {
  const { estimateCost } = await loadPricing()
  const root = tmpRoot()

  const tokensByModelA = { 'claude-sonnet-5': 400000 }
  const tokensByModelB = { 'claude-haiku-4-5': 900000 }
  const correctCostA = estimateCost(tokensByModelA).cost_est_usd
  const correctCostB = estimateCost(tokensByModelB).cost_est_usd

  const rowA = makeEntry({ id: 'f1-a', run_id: 'f1', workflow: 'a', tokens_by_model: tokensByModelA, tokens: 400000, cost_est_usd: correctCostA })
  const rowB = makeEntry({ id: 'f2-b', run_id: 'f2', workflow: 'b', tokens_by_model: tokensByModelB, tokens: 900000, cost_est_usd: correctCostB })
  writeIndex(root, [rowA, rowB])
  writeRun(root, 'f1-a', { ...rowA }, { marker: 'a-result' })
  writeRun(root, 'f2-b', { ...rowB }, { marker: 'b-result' })

  const indexBytesBefore = fs.readFileSync(indexPath(root))
  const runABytesBefore = fs.readFileSync(runPath(root, 'f1-a'))
  const runBBytesBefore = fs.readFileSync(runPath(root, 'f2-b'))

  const r = cli('ledger', ['recost'], { root })
  assert.equal(r.code, 0, `${r.out}\n${r.err}`)

  assert.ok(Buffer.compare(fs.readFileSync(indexPath(root)), indexBytesBefore) === 0, 'ledger/index.jsonl must be byte-identical to before')
  assert.ok(Buffer.compare(fs.readFileSync(runPath(root, 'f1-a')), runABytesBefore) === 0, 'ledger/runs/f1-a.json must be byte-identical to before')
  assert.ok(Buffer.compare(fs.readFileSync(runPath(root, 'f2-b')), runBBytesBefore) === 0, 'ledger/runs/f2-b.json must be byte-identical to before')
})
