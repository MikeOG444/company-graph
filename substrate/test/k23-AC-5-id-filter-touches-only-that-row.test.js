// AC-5: `ledger recost <id>` is surgical across ROWS, not just within a row: given two rows A and B that are
// both stale, recosting only A's id must update A's index line and run file (only cost_est_usd differing),
// while B's index line stays byte-identical and B's run file stays byte-identical, and stdout reports 1 row.
// Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun, indexPath, runPath, readIndexRows, readRun, loadPricing, assertOnlyFieldChanged } from './k23-helpers.js'

// Returns the raw (unparsed) index-file line whose JSON contains `"id":"<id>"`, so byte-identity of an
// untouched row's line can be checked without assuming row order or re-serialising it ourselves.
function rawLineForId(text, id) {
  const line = text.split('\n').find(l => l.includes(`"id":"${id}"`))
  assert.ok(line, `no index line found for id ${id}`)
  return line
}

test('AC-5: recost <id> updates only the named row; the other row\'s index line and run file are byte-identical to before, and stdout reports 1 row', async () => {
  const { estimateCost } = await loadPricing()
  const root = tmpRoot()

  const tokensA = { 'claude-sonnet-5': 400000 }
  const tokensB = { 'claude-haiku-4-5': 900000 }
  const entryA = makeEntry({ id: 'k5-a', run_id: 'k5', workflow: 'a', tokens_by_model: tokensA, tokens: 400000, cost_est_usd: 0.01 })
  const entryB = makeEntry({ id: 'k5-b', run_id: 'k5', workflow: 'b', tokens_by_model: tokensB, tokens: 900000, cost_est_usd: 0.01 })
  writeIndex(root, [entryA, entryB])
  const resultA = { marker: 'result-a' }
  const resultB = { marker: 'result-b' }
  writeRun(root, 'k5-a', entryA, resultA)
  writeRun(root, 'k5-b', entryB, resultB)

  const expectedA = estimateCost(tokensA).cost_est_usd
  const expectedB = estimateCost(tokensB).cost_est_usd
  assert.notEqual(expectedA, 0.01, 'row A must actually be stale')
  assert.notEqual(expectedB, 0.01, 'row B must actually be stale')

  const indexTextBefore = fs.readFileSync(indexPath(root), 'utf8')
  const bLineBefore = rawLineForId(indexTextBefore, 'k5-b')
  const runBTextBefore = fs.readFileSync(runPath(root, 'k5-b'), 'utf8')

  const r = cli('ledger', ['recost', 'k5-a'], { root })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /recosted 1 row/)

  // A: index row and run-file entry are both updated, only cost_est_usd differing.
  const indexRowA = readIndexRows(root).find(x => x.id === 'k5-a')
  assertOnlyFieldChanged(assert, entryA, indexRowA, 'cost_est_usd')
  assert.equal(indexRowA.cost_est_usd, expectedA)

  const runEntryA = readRun(root, 'k5-a').entry
  assertOnlyFieldChanged(assert, entryA, runEntryA, 'cost_est_usd')
  assert.equal(runEntryA.cost_est_usd, expectedA)

  // B: untouched by the id-filtered recost — index line and whole run file are byte-identical to before.
  const indexTextAfter = fs.readFileSync(indexPath(root), 'utf8')
  const bLineAfter = rawLineForId(indexTextAfter, 'k5-b')
  assert.equal(bLineAfter, bLineBefore, "row B's index line must be byte-identical to before")

  const runBTextAfter = fs.readFileSync(runPath(root, 'k5-b'), 'utf8')
  assert.equal(runBTextAfter, runBTextBefore, "row B's run file must be byte-identical to before")
})
