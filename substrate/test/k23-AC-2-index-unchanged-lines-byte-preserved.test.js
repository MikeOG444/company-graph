// AC-2: only rows whose cost_est_usd actually changes may have their serialized index line replaced.
// Unchanged rows' lines must be preserved byte-for-byte (including non-canonical key spacing), never
// round-tripped through JSON.stringify; row order, line count and trailing-newline shape are unchanged;
// only the repriced row's line differs. Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, indexPath, ledgerDir, writeRun, loadPricing } from './k23-helpers.js'

test('AC-2: recost preserves unchanged index lines byte-for-byte and rewrites only the repriced row', async () => {
  const { estimateCost } = await loadPricing()
  const root = tmpRoot()

  // Row 1: no tokens_by_model at all -> not a repricing candidate, must never be touched.
  const row1 = makeEntry({ id: 'r1-a', run_id: 'r1', workflow: 'a', cost_est_usd: 0.2 })
  delete row1.tokens_by_model

  // Row 2: has tokens_by_model, but its stored cost_est_usd already equals the recomputed value ->
  // recost recomputes it but the value does not change, so its line must not change either.
  const row2TokensByModel = { 'claude-haiku-4-5': 100000 }
  const row2CorrectCost = estimateCost(row2TokensByModel).cost_est_usd
  const row2 = makeEntry({
    id: 'r2-b', run_id: 'r2', workflow: 'b',
    tokens_by_model: row2TokensByModel, tokens: 100000, cost_est_usd: row2CorrectCost,
  })

  // Row 3: stale cost -> the one row that must actually be repriced.
  const row3TokensByModel = { 'claude-opus-5': 400000 }
  const row3 = makeEntry({
    id: 'r3-c', run_id: 'r3', workflow: 'c',
    tokens_by_model: row3TokensByModel, tokens: 400000, cost_est_usd: 0.01,
  })
  const row3Expected = estimateCost(row3TokensByModel).cost_est_usd
  assert.notEqual(row3Expected, 0.01, 'fixture row3 must actually be stale for this test to mean anything')

  // Serialize rows 1 and 2 with a deliberately non-canonical extra space after the first key's colon.
  // JSON.stringify(obj) never inserts that space, so any recost that round-trips an "unchanged" row
  // through JSON.stringify (even one that happens to preserve key order) is caught by this fixture.
  const line1 = JSON.stringify(row1).replace('"id":', '"id": ')
  const line2 = JSON.stringify(row2).replace('"id":', '"id": ')
  const line3 = JSON.stringify(row3)
  const originalText = [line1, line2, line3].join('\n') + '\n'

  fs.mkdirSync(ledgerDir(root), { recursive: true })
  fs.writeFileSync(indexPath(root), originalText)
  writeRun(root, 'r1-a', row1)
  writeRun(root, 'r2-b', row2)
  writeRun(root, 'r3-c', row3)

  const r = cli('ledger', ['recost'], { root })
  assert.equal(r.code, 0, r.err)

  const after = fs.readFileSync(indexPath(root), 'utf8')
  const beforeLines = originalText.split('\n')
  const afterLines = after.split('\n')

  assert.equal(afterLines.length, beforeLines.length, 'total line count must be unchanged')
  assert.equal(after.endsWith('\n'), originalText.endsWith('\n'), 'trailing-newline shape must be unchanged')
  assert.ok(!after.endsWith('\n\n'), 'no extra blank line introduced')

  assert.equal(afterLines[0], line1, 'row 1 (no tokens_by_model) line must be byte-identical to the original, including its non-canonical spacing')
  assert.equal(afterLines[1], line2, 'row 2 (already-correct cost) line must be byte-identical to the original, including its non-canonical spacing')
  assert.notEqual(afterLines[2], line3, 'row 3 (stale cost) line must differ from the original')

  const row3After = JSON.parse(afterLines[2])
  assert.equal(row3After.id, 'r3-c')
  assert.equal(row3After.cost_est_usd, row3Expected)

  // Row order preserved.
  assert.deepEqual(afterLines.slice(0, 3).map(l => JSON.parse(l).id), ['r1-a', 'r2-b', 'r3-c'], 'row order must be unchanged')
})
