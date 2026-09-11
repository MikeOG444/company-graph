// Tests for spec-wi-opp-p5-5 ("ledger append --from-output"), written from the spec
// (.artifacts/build/t4/specs/spec-wi-opp-p5-5.json) alone — no implementation of
// substrate/ledger.js or substrate/lib/run-output.js was read to write these.
//
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). Uses the repo's existing test helper
// (./helpers.js: cli, tmpRoot, FIX) exactly as substrate/test/ledger.test.js does.
//
// All Workflow task-output fixtures used below are constructed in-line (as plain JS
// objects, written to a temp file with the canonical basename) rather than committed
// binary fixtures, so these tests have no dependency on exactly what content anyone
// else commits at substrate/test/fixtures/task-output.valid.json /
// task-output.zero-wall.json — they assert the derivation *algorithm* the spec
// describes, against data this file fully controls.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { cli, tmpRoot, FIX, REPO } from './helpers.js'

const RUN_OUTPUT_JS = path.join(REPO, 'substrate', 'lib', 'run-output.js')

// ---- fixture builders --------------------------------------------------------

// A Workflow task-output file with 3 workflow_agent entries whose model ids need
// normalizeModel collapsing (per AC-1's own example), non-aligned queuedAt/startedAt/
// lastProgressAt/durationMs, and a `result` carrying a provenance block.
//
// Hand-derived expected values (epoch ms -> ISO, see comments beside each field):
//   agent 1 (sonnet):  queuedAt 1789120800000 (10:00:00.000Z) startedAt 1789120802000 (10:00:02.000Z) lastProgressAt 1789121100000 (10:05:00.000Z) tokens 500000
//   agent 2 (haiku):   queuedAt 1789120801000 (10:00:01.000Z) startedAt 1789120803000 (10:00:03.000Z) durationMs 120000 -> finishes 1789120923000 (10:02:03.000Z) tokens 500000
//   agent 3 (opus):    queuedAt 1789120799000 (09:59:59.000Z) startedAt 1789120804000 (10:00:04.000Z) lastProgressAt 1789120980000 (10:03:00.000Z) tokens 1000000
// started_at = min(all queuedAt/startedAt) = agent 3's queuedAt = 2026-09-11T09:59:59.000Z
// finished_at = max(lastProgressAt, startedAt+durationMs) per agent = agent 1's lastProgressAt = 2026-09-11T10:05:00.000Z
// wall_clock_sec = round((finished - started)/1000) = 301
// tokens = 2,000,000; tokens_by_model = { claude-sonnet-5: 500000, claude-haiku-4-5: 500000, claude-opus-5: 1000000 }
// cost: sonnet 0.5M*(0.9*2+0.1*10)=1.4, haiku 0.5M*(0.9*1+0.1*5)=0.7, opus 1M*(0.9*5+0.1*25)=7.0 -> total 9.1
function buildValidOutput(resultOverride) {
  return {
    summary: 'fixture task output for ledger --from-output tests',
    agentCount: 3,
    logs: ['3 tasks', 'fixture'],
    result: resultOverride !== undefined ? resultOverride : {
      id: 'fixture-result-valid',
      status: 'ok',
      provenance: { node: 'build-implement', executor: 'ai_agent', method: 'hotl', model: 'n/a', run_id: 'rX', created_at: '2026-09-11T10:00:00Z' },
    },
    workflowProgress: [
      { type: 'workflow_phase', index: 1, title: 'Implement' },
      { type: 'workflow_agent', label: 'impl:t1', agentType: 'implementer', model: 'claude-sonnet-5', tokens: 500000, queuedAt: 1789120800000, startedAt: 1789120802000, lastProgressAt: 1789121100000 },
      { type: 'workflow_agent', label: 'tests:t1', agentType: 'test-author', model: 'claude-haiku-4-5-20251001', tokens: 500000, queuedAt: 1789120801000, startedAt: 1789120803000, durationMs: 120000 },
      { type: 'workflow_agent', label: 'lens:security:t1', agentType: 'lens-security', model: 'claude-opus-5[1m]', tokens: 1000000, queuedAt: 1789120799000, startedAt: 1789120804000, lastProgressAt: 1789120980000 },
    ],
    totalTokens: 2000000,
  }
}
const EXPECT = {
  started_at: '2026-09-11T09:59:59.000Z',
  finished_at: '2026-09-11T10:05:00.000Z',
  wall_clock_sec: 301,
  tokens: 2000000,
  tokens_by_model: { 'claude-sonnet-5': 500000, 'claude-haiku-4-5': 500000, 'claude-opus-5': 1000000 },
  cost_est_usd: 9.1,
  agents: 3,
}

// A single-agent output whose queuedAt/startedAt/lastProgressAt are all equal (wall
// clock derives to 0) while its token total is non-zero -> the AC-3 refusal case.
function buildZeroWallOutput() {
  const T = 1789120800000 // 2026-09-11T10:00:00.000Z
  return {
    summary: 'fixture zero-wall task output',
    agentCount: 1,
    logs: ['fixture'],
    result: { id: 'fixture-result-zero-wall', status: 'ok', provenance: { node: 'maintain-triage', executor: 'ai_agent', method: 'hotl', model: 'n/a', run_id: 'rZ', created_at: '2026-09-11T10:00:00Z' } },
    workflowProgress: [
      { type: 'workflow_agent', label: 'impl:t2', agentType: 'implementer', model: 'claude-sonnet-5', tokens: 1000, queuedAt: T, startedAt: T, lastProgressAt: T },
    ],
    totalTokens: 1000,
  }
}

function writeFixture(root, basename, obj) {
  const p = path.join(root, basename)
  fs.writeFileSync(p, JSON.stringify(obj, null, 2))
  return p
}

function readEntry(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'ledger', 'index.jsonl'), 'utf8').trim())
}

function ledgerUntouched(root) {
  return !fs.existsSync(path.join(root, 'ledger', 'index.jsonl')) &&
    (!fs.existsSync(path.join(root, 'ledger', 'runs')) || fs.readdirSync(path.join(root, 'ledger', 'runs')).length === 0)
}

// A full, schema-shaped LedgerEntry, for tests that construct rows directly rather
// than through `ledger append` (AC-13/AC-14 need a ledger with a pre-existing marked
// row; the spec gives no CLI flag to set wall_clock_unknown on a fresh append — it is
// only ever set by hand on the one already-corrupt historical row, AC-12).
function rawEntry(overrides) {
  return {
    id: `${overrides.run_id}-${overrides.workflow}`,
    status: 'ok',
    artifact_count: 0,
    escalations: 0,
    result_ref: `ledger/runs/${overrides.run_id}-${overrides.workflow}.json`,
    provenance: { node: overrides.workflow, executor: 'ai_agent', method: 'hotl', run_id: overrides.run_id, created_at: overrides.started_at },
    ...overrides,
  }
}
function writeRawEntry(root, entry) {
  fs.mkdirSync(path.join(root, 'ledger', 'runs'), { recursive: true })
  fs.appendFileSync(path.join(root, 'ledger', 'index.jsonl'), JSON.stringify(entry) + '\n')
  fs.writeFileSync(path.join(root, 'ledger', 'runs', `${entry.id}.json`), JSON.stringify({ entry, result: {} }, null, 2))
}

const bundle = () => path.join(FIX, 'evidence-bundle.valid.json')

// ---- AC-1 ----------------------------------------------------------------------

test('AC-1: --from-output derives agents, tokens_by_model, tokens, both timestamps and result from the task output file', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.valid.json', buildValidOutput())

  const r = cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r1', '--from-output', out], { root })
  assert.equal(r.code, 0, r.err)

  const entry = readEntry(root)
  assert.equal(entry.agents, EXPECT.agents)
  assert.deepEqual(entry.tokens_by_model, EXPECT.tokens_by_model)
  assert.equal(entry.tokens, EXPECT.tokens)
  assert.equal(entry.started_at, EXPECT.started_at)
  assert.equal(entry.finished_at, EXPECT.finished_at)
  assert.equal(entry.wall_clock_sec, EXPECT.wall_clock_sec)
  assert.equal(entry.cost_est_usd, EXPECT.cost_est_usd)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(entry) }).code, 0)

  const stored = JSON.parse(fs.readFileSync(path.join(root, entry.result_ref), 'utf8'))
  assert.deepEqual(stored.result, buildValidOutput().result)
})

// ---- AC-2 ----------------------------------------------------------------------

test('AC-2: explicit flags override --from-output-derived values; unspecified fields still come from the file', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.valid.json', buildValidOutput())

  // Override --started and --agents; tokens/tokens_by_model/finished_at stay derived.
  const r = cli('ledger', ['append', '--workflow', 'w', '--run', 'r2', '--from-output', out,
    '--started', '2026-09-11T09:58:59Z', '--agents', '99'], { root })
  assert.equal(r.code, 0, r.err)
  const entry = readEntry(root)
  assert.equal(entry.started_at, '2026-09-11T09:58:59.000Z')
  assert.equal(entry.agents, 99)
  assert.equal(entry.finished_at, EXPECT.finished_at)
  assert.equal(entry.tokens, EXPECT.tokens)
  assert.deepEqual(entry.tokens_by_model, EXPECT.tokens_by_model)
  // wall clock reflects the overridden start, not the derived one: 09:58:59 -> 10:05:00 = 361s.
  assert.equal(entry.wall_clock_sec, 361)

  // Override --result: the stored result comes from the override file, not doc.result.
  const overrideResult = path.join(root, 'override-result.json')
  fs.writeFileSync(overrideResult, JSON.stringify({ marker: 'override-result' }))
  const r2 = cli('ledger', ['append', '--workflow', 'w', '--run', 'r3', '--from-output', out, '--result', overrideResult], { root })
  assert.equal(r2.code, 0, r2.err)
  const entries = fs.readFileSync(path.join(root, 'ledger', 'index.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const e3 = entries.find(e => e.run_id === 'r3')
  const stored3 = JSON.parse(fs.readFileSync(path.join(root, e3.result_ref), 'utf8'))
  assert.deepEqual(stored3.result, { marker: 'override-result' })
  // Non-result fields for this run are still derived from the file.
  assert.equal(e3.tokens, EXPECT.tokens)
})

// ---- AC-3 ------------------------------------------------------------------------

test('AC-3: zero derived wall clock beside non-zero tokens refuses (exit 2), writes nothing', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.zero-wall.json', buildZeroWallOutput())

  const r = cli('ledger', ['append', '--workflow', 'maintain-triage', '--run', 'z1', '--from-output', out], { root })
  assert.equal(r.code, 2)
  assert.match(r.err, /2026-09-11T10:00:00/) // names the computed started_at/finished_at
  assert.match(r.err, /1000/) // names the token total
  assert.match(r.err, /--started|--now/)
  assert.ok(ledgerUntouched(root), 'nothing should be written on refusal')
})

// ---- AC-4 --------------------------------------------------------------------------

test('AC-4: finished_at before started_at refuses (exit 2) without clamping to 0, writes nothing — the m2 regression shape', () => {
  const root = tmpRoot()
  const r = cli('ledger', ['append', '--workflow', 'maintain-triage', '--run', 'm9',
    '--started', '2026-09-11T03:36:00Z', '--now', '2026-09-11T03:33:58.960Z',
    '--tokens', '338559', '--result', bundle()], { root })
  assert.equal(r.code, 2)
  assert.match(r.err, /finished/i)
  assert.match(r.err, /2026-09-11T03:36:00/)
  assert.match(r.err, /2026-09-11T03:33:58\.960/)
  assert.ok(ledgerUntouched(root), 'a finished-before-started run must write nothing, not clamp to wall_clock_sec 0')
})

// ---- AC-5 --------------------------------------------------------------------------

test('AC-5: zero wall clock with zero (or absent) tokens succeeds — the refusal is scoped to non-zero tokens', () => {
  const root = tmpRoot()
  const r = cli('ledger', ['append', '--workflow', 'w', '--run', 'r5',
    '--started', '2026-09-10T10:00:00Z', '--now', '2026-09-10T10:00:00Z', '--result', bundle()], { root })
  assert.equal(r.code, 0, r.err)
  const entry = readEntry(root)
  assert.equal(entry.wall_clock_sec, 0)
})

// ---- AC-6 --------------------------------------------------------------------------

test('AC-6: successful append with a tokens_by_model split prints per-model cost lines, ordered by cost descending', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.valid.json', buildValidOutput())
  const r = cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r6', '--from-output', out], { root })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^appended r6-build-implement: 301s, 2000000 tokens(, ~\$[\d.]+)?, \d+ artifacts, \d+ escalations/m)

  const idxOpus = r.out.indexOf('claude-opus-5')
  const idxSonnet = r.out.indexOf('claude-sonnet-5')
  const idxHaiku = r.out.indexOf('claude-haiku-4-5')
  assert.ok(idxOpus > -1 && idxSonnet > -1 && idxHaiku > -1, r.out)
  // opus ($7.0) > sonnet ($1.4) > haiku ($0.7): descending by cost.
  assert.ok(idxOpus < idxSonnet && idxSonnet < idxHaiku, r.out)

  // A model absent from pricing.json prices as "$?" on the same per-model line.
  const spec = path.join(root, 'r7.json')
  fs.writeFileSync(spec, JSON.stringify({ provenance: { node: 'x', executor: 'ai_agent', method: 'hotl', run_id: 'r7', created_at: '2026-09-10T10:00:00Z' } }))
  const r2 = cli('ledger', ['append', '--workflow', 'w', '--run', 'r7', '--started', '2026-09-10T10:00:00Z', '--now', '2026-09-10T10:01:00Z',
    '--result', spec, '--tokens-by-model', JSON.stringify({ 'claude-unknown-9': 1000 })], { root })
  assert.equal(r2.code, 0, r2.err)
  const unknownLine = r2.out.split('\n').find(l => l.includes('claude-unknown-9'))
  assert.ok(unknownLine, r2.out)
  assert.match(unknownLine, /\$\?/)
})

// ---- AC-7 --------------------------------------------------------------------------

test('AC-7: legacy flag-only usage (no --from-output) remains fully backward compatible', () => {
  const root = tmpRoot()
  const journal = path.join(root, 'journal.jsonl')
  fs.writeFileSync(journal, '{"agent":"planner","result":{}}\n')

  const r = cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r1', '--started', '2026-09-10T10:00:00Z',
    '--result', bundle(), '--tokens', '48000', '--agents', '9', '--journal', journal, '--now', '2026-09-10T10:09:30Z'], { root })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /appended r1-build-implement: 570s, 48000 tokens, 2 artifacts, 0 escalations/)

  // Duplicate id still refused.
  assert.equal(cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'r1', '--started', '2026-09-10T10:00:00Z', '--result', bundle()], { root }).code, 1)
  // Negative tokens still refused with exit 2.
  assert.equal(cli('ledger', ['append', '--workflow', 'x', '--run', 'r3', '--started', '2026-09-10T12:00:00Z', '--result', bundle(), '--tokens', '-1'], { root }).code, 2)
})

// ---- AC-8 --------------------------------------------------------------------------

test('AC-8: an unreadable / non-JSON / agent-less output file refuses (exit 2), writing nothing', () => {
  const root = tmpRoot()

  const missing = path.join(root, 'does-not-exist.output')
  const empty = path.join(root, 'empty.output'); fs.writeFileSync(empty, '')
  const plainText = path.join(root, 'text.output'); fs.writeFileSync(plainText, 'not json at all')
  const noProgress = path.join(root, 'no-progress.output'); fs.writeFileSync(noProgress, JSON.stringify({ result: {} }))
  const noAgents = path.join(root, 'no-agents.output'); fs.writeFileSync(noAgents, JSON.stringify({ result: {}, workflowProgress: [{ type: 'workflow_phase', index: 1, title: 'x' }] }))

  let i = 0
  for (const p of [missing, empty, plainText, noProgress, noAgents]) {
    const r = cli('ledger', ['append', '--workflow', 'w', '--run', `bad${i++}`, '--from-output', p], { root })
    assert.equal(r.code, 2, `${p} should refuse: ${r.out} ${r.err}`)
    assert.ok(r.err.includes(p) || r.err.includes(path.basename(p)), `error should name the path for ${p}: ${r.err}`)
  }
  assert.ok(ledgerUntouched(root))
})

// ---- AC-9 --------------------------------------------------------------------------

test('AC-9: a missing/null result in the output file requires --result; succeeds when --result is passed', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'no-result.output', buildValidOutput(null))

  const r = cli('ledger', ['append', '--workflow', 'w', '--run', 'nr1', '--from-output', out], { root })
  assert.equal(r.code, 2)
  assert.match(r.err, /result/i)
  assert.match(r.err, /--result/)
  assert.ok(ledgerUntouched(root))

  const r2 = cli('ledger', ['append', '--workflow', 'w', '--run', 'nr2', '--from-output', out, '--result', bundle()], { root })
  assert.equal(r2.code, 0, r2.err)
  const entries = fs.readFileSync(path.join(root, 'ledger', 'index.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const e2 = entries.find(e => e.run_id === 'nr2')
  const stored = JSON.parse(fs.readFileSync(path.join(root, e2.result_ref), 'utf8'))
  assert.deepEqual(stored.result, JSON.parse(fs.readFileSync(bundle(), 'utf8')))
})

// ---- AC-10 -------------------------------------------------------------------------

test('AC-10: run-output.js CLI keeps printing agents/tokens_by_model/logs, --save keeps working, and gains derived fields plus a pure export', async () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.valid.json', buildValidOutput())

  const r = spawnSync(process.execPath, [RUN_OUTPUT_JS, out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const printed = JSON.parse(r.stdout)
  assert.equal(printed.agents, EXPECT.agents)
  assert.deepEqual(printed.tokens_by_model, EXPECT.tokens_by_model)
  assert.ok(Array.isArray(printed.logs))
  assert.equal(printed.started_at, EXPECT.started_at)
  assert.equal(printed.finished_at, EXPECT.finished_at)
  assert.equal(printed.tokens, EXPECT.tokens)

  const savePath = path.join(root, 'saved-result.json')
  const rSave = spawnSync(process.execPath, [RUN_OUTPUT_JS, out, '--save', savePath], { encoding: 'utf8' })
  assert.equal(rSave.status, 0, rSave.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(savePath, 'utf8')), buildValidOutput().result)

  // Importing the module (not running it as a CLI) must not execute the CLI body, and
  // must expose a pure readRunOutput(path) that ledger.js can reuse.
  const mod = await import(pathToFileURL(RUN_OUTPUT_JS).href)
  assert.equal(typeof mod.readRunOutput, 'function')
  const derived = await mod.readRunOutput(out)
  assert.equal(derived.agents, EXPECT.agents)
  assert.deepEqual(derived.tokens_by_model, EXPECT.tokens_by_model)
  assert.equal(derived.started_at, EXPECT.started_at)
  assert.equal(derived.finished_at, EXPECT.finished_at)
  assert.equal(derived.tokens, EXPECT.tokens)
})

// ---- AC-11 -------------------------------------------------------------------------

test('AC-11: LedgerEntry validates with wall_clock_unknown true, and still validates when the field is absent', () => {
  const root = tmpRoot()
  const base = {
    id: 'x1-w', run_id: 'x1', workflow: 'w', status: 'ok',
    started_at: '2026-09-10T00:00:00Z', finished_at: '2026-09-10T00:01:00Z', wall_clock_sec: 60,
    artifact_count: 0, escalations: 0, result_ref: 'ledger/runs/x1-w.json',
    provenance: { node: 'w', executor: 'ai_agent', method: 'hotl', run_id: 'x1', created_at: '2026-09-10T00:00:00Z' },
  }
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(base) }).code, 0)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify({ ...base, wall_clock_unknown: true }) }).code, 0)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify({ ...base, wall_clock_unknown: false }) }).code, 0)
  // Declared boolean: a non-boolean value must not validate.
  assert.notEqual(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify({ ...base, wall_clock_unknown: 'yes' }) }).code, 0)
})

// ---- AC-12 -------------------------------------------------------------------------

// This is NOT a synthetic-fixture test: it inspects the actual committed rows at
// REPO/ledger/index.jsonl and REPO/ledger/runs/m2-maintain-triage.json (REPO resolves
// from substrate/test/helpers.js, so in the implementer's worktree this is that
// worktree's own copy, never the repo-root checkout). The pre-change values below are
// hand-transcribed from those files as committed before this work item (the corrupt
// row the spec names): every field must survive untouched except the new flag.
test('AC-12: the committed m2-maintain-triage row is marked wall_clock_unknown, every other field untouched', () => {
  const EXPECT_ENTRY_UNCHANGED = {
    id: 'm2-maintain-triage', run_id: 'm2', workflow: 'maintain-triage', status: 'ok',
    started_at: '2026-09-11T03:36:00.000Z', finished_at: '2026-09-11T03:33:58.960Z',
    wall_clock_sec: 0, result_ref: 'ledger/runs/m2-maintain-triage.json',
    artifact_count: 8, escalations: 0,
    tokens_by_model: { 'claude-haiku-4-5': 99879, 'claude-sonnet-5': 238680 },
    tokens: 338559, cost_est_usd: 0.81, agents: 9,
    provenance: {
      node: 'maintain-triage', executor: 'ai_agent', method: 'hotl', model: 'n/a',
      run_id: 'm2', created_at: '2026-09-11T03:36:00Z',
    },
    trace_ref: '.artifacts/traces/m2-maintain-triage.jsonl',
  }
  const EXPECT = { ...EXPECT_ENTRY_UNCHANGED, wall_clock_unknown: true }

  // index.jsonl: one JSON object per line, already flat in LedgerEntry shape.
  const indexPath = path.join(REPO, 'ledger', 'index.jsonl')
  const lines = fs.readFileSync(indexPath, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const indexRow = lines.find(r => r.id === 'm2-maintain-triage')
  assert.ok(indexRow, 'ledger/index.jsonl must still contain the m2-maintain-triage row')
  assert.equal(indexRow.wall_clock_unknown, true, 'ledger/index.jsonl row must carry wall_clock_unknown: true')
  assert.deepEqual(indexRow, EXPECT, 'every field besides wall_clock_unknown must be exactly as committed, and started_at must not be invented')

  // ledger/runs/m2-maintain-triage.json: the entry lives nested under `entry`; `result` is untouched and not asserted here.
  const runsPath = path.join(REPO, 'ledger', 'runs', 'm2-maintain-triage.json')
  const runsDoc = JSON.parse(fs.readFileSync(runsPath, 'utf8'))
  assert.equal(runsDoc.entry.wall_clock_unknown, true, 'ledger/runs/m2-maintain-triage.json entry block must carry wall_clock_unknown: true')
  assert.deepEqual(runsDoc.entry, EXPECT, 'the runs-file entry block must match index.jsonl exactly, field for field')

  // node substrate/validator.js LedgerEntry must pass on the marked entry.
  const root = tmpRoot()
  const entryPath = path.join(root, 'm2-entry.json')
  fs.writeFileSync(entryPath, JSON.stringify(indexRow))
  const v = cli('validator', ['LedgerEntry', entryPath], { root })
  assert.equal(v.code, 0, v.out + v.err)
})

// ---- AC-13 -------------------------------------------------------------------------

test('AC-13: summary --by method|workflow excludes wall_clock_unknown rows from the wall-clock total and reports wall_unknown_runs', () => {
  const root = tmpRoot()
  const marked = rawEntry({
    run_id: 'a1', workflow: 'w', started_at: '2026-09-10T00:00:00Z', finished_at: '2026-09-10T00:01:40Z',
    wall_clock_sec: 100, tokens: 1000, agents: 1, wall_clock_unknown: true,
  })
  const unmarked = rawEntry({
    run_id: 'a2', workflow: 'w', started_at: '2026-09-10T01:00:00Z', finished_at: '2026-09-10T01:00:50Z',
    wall_clock_sec: 50, tokens: 2000, agents: 1,
  })
  writeRawEntry(root, marked)
  writeRawEntry(root, unmarked)
  assert.equal(cli('validator', ['LedgerEntry', '-'], { root, input: JSON.stringify(marked) }).code, 0)

  for (const by of ['method', 'workflow']) {
    const groups = JSON.parse(cli('ledger', ['summary', '--by', by, '--json'], { root }).out)
    const key = by === 'method' ? 'hotl' : 'w'
    const g = groups.find(x => x.key === key)
    assert.ok(g, JSON.stringify(groups))
    assert.equal(g.runs, 2)
    assert.equal(g.tokens, 3000, 'tokens keep counting the marked row; only wall clock is excluded')
    assert.equal(g.wall_clock_sec, 50, "the marked row's wall_clock_sec must not be added to the group total")
    assert.equal(g.wall_unknown_runs, 1)
  }
})

// ---- AC-14 -------------------------------------------------------------------------

test('AC-14: ledger list renders a wall_clock_unknown row as "?s" and keeps the field in --json', () => {
  const root = tmpRoot()
  const marked = rawEntry({
    run_id: 'b1', workflow: 'w', started_at: '2026-09-10T00:00:00Z', finished_at: '2026-09-10T00:01:40Z',
    wall_clock_sec: 100, tokens: 1000, agents: 1, wall_clock_unknown: true,
  })
  const unmarked = rawEntry({
    run_id: 'b2', workflow: 'w', started_at: '2026-09-10T01:00:00Z', finished_at: '2026-09-10T01:00:50Z',
    wall_clock_sec: 50, tokens: 2000, agents: 1,
  })
  writeRawEntry(root, marked)
  writeRawEntry(root, unmarked)

  const list = cli('ledger', ['list'], { root })
  assert.equal(list.code, 0, list.err)
  assert.match(list.out, /\?s/)
  assert.match(list.out, /\b50s\b/)
  assert.doesNotMatch(list.out, /\b100s\b/)

  const listJson = JSON.parse(cli('ledger', ['list', '--json'], { root }).out)
  const b1 = listJson.find(e => e.id === 'b1-w')
  const b2 = listJson.find(e => e.id === 'b2-w')
  assert.equal(b1.wall_clock_unknown, true)
  assert.ok(!b2.wall_clock_unknown)
})

// ---- AC-15 -------------------------------------------------------------------------

test('AC-15: --from-output combined with --journal/--status/--human-min keeps those three operator-supplied', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.valid.json', buildValidOutput())
  const journal = path.join(root, 'journal.jsonl')
  fs.writeFileSync(journal, '{"agent":"planner","result":{}}\n')

  const r = cli('ledger', ['append', '--workflow', 'w', '--run', 's1', '--from-output', out,
    '--journal', journal, '--status', 'failed', '--human-min', '15'], { root })
  assert.equal(r.code, 0, r.err)
  const entry = readEntry(root)
  assert.equal(entry.status, 'failed')
  assert.equal(entry.human_min, 15)
  assert.equal(entry.trace_ref, `.artifacts/traces/${entry.id}.jsonl`)
  assert.ok(fs.existsSync(path.join(root, entry.trace_ref)))

  const rMissingJournal = cli('ledger', ['append', '--workflow', 'w', '--run', 's2', '--from-output', out,
    '--journal', path.join(root, 'no-such-journal.jsonl')], { root })
  assert.equal(rMissingJournal.code, 2)
})

// ---- AC-16 -------------------------------------------------------------------------

test('AC-16: substrate/README.md documents --from-output as the default gate-turn form and lists wall_clock_unknown', () => {
  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  assert.match(readme, /ledger(\.js)? append --workflow <w> --run <r> --from-output <task\.output>/)
  assert.match(readme, /wall_clock_unknown/)
})

// ---- AC-17 -------------------------------------------------------------------------
// AC-17 asks that substrate/test/ledger.test.js contain new cases covering AC-1,
// AC-3/AC-4 (both refusals, asserting nothing is written), AC-6 (the by-model split)
// and AC-13 (a marked row excluded from the aggregate). Those exact scenarios are the
// dedicated tests above; this case re-affirms that a passing run of this whole file
// (which lands into substrate/test/) leaves the pre-existing ledger.test.js scenario
// (duplicate run refusal, negative --tokens refusal, --by method/model summaries)
// intact, matching AC-7's contract that nothing existing regresses.
test('AC-17: the new --from-output scenarios and the pre-existing duplicate/negative-token refusals coexist in one root', () => {
  const root = tmpRoot()
  const out = writeFixture(root, 'task-output.valid.json', buildValidOutput())
  assert.equal(cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'z1', '--from-output', out], { root }).code, 0)
  assert.equal(cli('ledger', ['append', '--workflow', 'build-implement', '--run', 'z1', '--from-output', out], { root }).code, 1)
  assert.equal(cli('ledger', ['append', '--workflow', 'w', '--run', 'z2', '--started', '2026-09-10T12:00:00Z', '--result', bundle(), '--tokens', '-1'], { root }).code, 2)
})
