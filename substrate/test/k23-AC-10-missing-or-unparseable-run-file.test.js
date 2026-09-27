// AC-10: when a row's ledger/runs/<id>.json is missing or unparseable, `recost` must detect this before any
// write, exit non-zero with a message naming the offending row id and the run file path (not an uncaught
// ENOENT/SyntaxError stack), and leave ledger/index.jsonl plus every existing run file byte-identical to
// before. Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cli, tmpRoot } from './helpers.js'
import { makeEntry, writeIndex, writeRun, indexPath, runPath, runsDir } from './k23-helpers.js'

test('AC-10: a missing run file is detected before any write; recost exits non-zero naming the row id and run file path, and leaves index + other run files byte-identical', () => {
  const root = tmpRoot()

  // rowMissing: stale cost, but its run file is never written (missing).
  const rowMissing = makeEntry({
    id: 'm1-w', run_id: 'm1', workflow: 'w',
    tokens_by_model: { 'claude-sonnet-5': 500000 }, tokens: 500000, cost_est_usd: 1.0,
  })
  // rowOk: stale cost, with a valid, parseable run file — must be left untouched because the
  // missing/unreadable pair must be detected before any write happens.
  const rowOk = makeEntry({
    id: 'm2-w', run_id: 'm2', workflow: 'w',
    tokens_by_model: { 'claude-sonnet-5': 200000 }, tokens: 200000, cost_est_usd: 1.0,
  })
  writeIndex(root, [rowMissing, rowOk])
  writeRun(root, 'm2-w', { ...rowOk }, { marker: 'orig' })
  // rowMissing's run file (ledger/runs/m1-w.json) is intentionally never created.

  const indexBefore = fs.readFileSync(indexPath(root), 'utf8')
  const runOkBefore = fs.readFileSync(runPath(root, 'm2-w'), 'utf8')

  const r = cli('ledger', ['recost'], { root })

  assert.notEqual(r.code, 0, 'recost must exit non-zero when a row\'s run file is missing')
  const combined = `${r.out}\n${r.err}`
  assert.ok(!/\n\s*at\s+\S+\s*\(?.*:\d+:\d+\)?/.test(`\n${combined}`),
    `must not surface an uncaught stack trace:\n${combined}`)
  const offendingLine = combined.split('\n').find(l => l.includes('m1-w'))
  assert.ok(offendingLine, `expected a line naming the offending row id m1-w in:\n${combined}`)
  assert.match(offendingLine, /ledger[\\/]runs[\\/]m1-w\.json/,
    `expected the offending line to name the run file path (ledger/runs/m1-w.json):\n${offendingLine}`)

  assert.equal(fs.readFileSync(indexPath(root), 'utf8'), indexBefore,
    'ledger/index.jsonl must be byte-identical to before — no write before the missing pair is detected')
  assert.equal(fs.readFileSync(runPath(root, 'm2-w'), 'utf8'), runOkBefore,
    'the other row\'s run file must be byte-identical to before — no write before the missing pair is detected')
})

test('AC-10: an unparseable run file is detected before any write; recost exits non-zero naming the row id and run file path, and leaves index + other run files byte-identical', () => {
  const root = tmpRoot()

  const rowBad = makeEntry({
    id: 'b1-w', run_id: 'b1', workflow: 'w',
    tokens_by_model: { 'claude-sonnet-5': 500000 }, tokens: 500000, cost_est_usd: 1.0,
  })
  const rowOk = makeEntry({
    id: 'b2-w', run_id: 'b2', workflow: 'w',
    tokens_by_model: { 'claude-sonnet-5': 200000 }, tokens: 200000, cost_est_usd: 1.0,
  })
  writeIndex(root, [rowBad, rowOk])
  writeRun(root, 'b2-w', { ...rowOk }, { marker: 'orig' })
  // rowBad's run file exists but is not parseable JSON.
  fs.mkdirSync(runsDir(root), { recursive: true })
  fs.writeFileSync(runPath(root, 'b1-w'), '{ not valid json')

  const indexBefore = fs.readFileSync(indexPath(root), 'utf8')
  const runBadBefore = fs.readFileSync(runPath(root, 'b1-w'), 'utf8')
  const runOkBefore = fs.readFileSync(runPath(root, 'b2-w'), 'utf8')

  const r = cli('ledger', ['recost'], { root })

  assert.notEqual(r.code, 0, 'recost must exit non-zero when a row\'s run file is unparseable')
  const combined = `${r.out}\n${r.err}`
  const offendingLine = combined.split('\n').find(l => l.includes('b1-w'))
  assert.ok(offendingLine, `expected a line naming the offending row id b1-w in:\n${combined}`)
  assert.match(offendingLine, /ledger[\\/]runs[\\/]b1-w\.json/,
    `expected the offending line to name the run file path (ledger/runs/b1-w.json):\n${offendingLine}`)

  assert.equal(fs.readFileSync(indexPath(root), 'utf8'), indexBefore,
    'ledger/index.jsonl must be byte-identical to before — no write before the unreadable pair is detected')
  assert.equal(fs.readFileSync(runPath(root, 'b1-w'), 'utf8'), runBadBefore,
    'the unparseable run file itself must be left untouched')
  assert.equal(fs.readFileSync(runPath(root, 'b2-w'), 'utf8'), runOkBefore,
    'the other row\'s run file must be byte-identical to before — no write before the unreadable pair is detected')
})
