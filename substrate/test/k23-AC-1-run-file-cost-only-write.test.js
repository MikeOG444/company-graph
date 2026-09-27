// AC-1: recost writes ONLY cost_est_usd into the run file's entry — never overwriting the run file's whole
// entry with the (possibly stale) index row, and never touching doc.result. Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun, readIndexRows, readRun, loadPricing, assertOnlyFieldChanged } from './k23-helpers.js'

test('AC-1: a hand-corrected run-file entry keeps its own tokens/tokens_by_model/wall_clock_unknown after recost; only cost_est_usd moves, doc.result is untouched', async () => {
  const { estimateCost } = await loadPricing()
  const root = tmpRoot()

  const indexTokens = { 'claude-sonnet-5': 500000 }
  const indexEntry = makeEntry({
    id: 'k1-x', run_id: 'k1', workflow: 'x',
    tokens_by_model: indexTokens, tokens: 500000, cost_est_usd: 1.0, // stale
  })
  writeIndex(root, [indexEntry])

  // The run file's entry was hand-corrected after append (k1's own regression shape): a larger `tokens`,
  // a different `tokens_by_model`, and `wall_clock_unknown: true` the index row does not carry.
  const runEntryBefore = {
    ...indexEntry,
    tokens: 3410972,
    tokens_by_model: { 'claude-opus-5': 3410972 },
    wall_clock_unknown: true,
  }
  const resultBefore = { marker: 'orig-result', nested: { a: 1 } }
  writeRun(root, 'k1-x', runEntryBefore, resultBefore)

  cli('ledger', ['recost'], { root })

  const doc = readRun(root, 'k1-x')
  assert.equal(doc.entry.tokens, 3410972, 'the hand-corrected tokens must survive')
  assert.deepEqual(doc.entry.tokens_by_model, { 'claude-opus-5': 3410972 }, 'the hand-corrected tokens_by_model must survive')
  assert.equal(doc.entry.wall_clock_unknown, true, 'wall_clock_unknown must survive')
  assert.deepEqual(doc.result, resultBefore, 'doc.result must be untouched by recost')

  const expectedCost = estimateCost(indexTokens).cost_est_usd
  assertOnlyFieldChanged(assert, runEntryBefore, doc.entry, 'cost_est_usd')
  assert.equal(doc.entry.cost_est_usd, expectedCost)
})
