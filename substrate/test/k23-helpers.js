// Shared fixture helpers for the k23 TestSet (spec-wi-c11-ledger-recost-surgical), written from the Spec
// alone. Builds small index/run-file pairs under a tmpRoot() so every test drives `substrate/ledger.js`
// against a throwaway `ledger/` directory, never the repository's own.
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './helpers.js'

// estimateCost is pure and lives in substrate/lib/pricing.js; imported dynamically by an absolute path
// computed from REPO (never a relative import that climbs out of this TestSet directory).
export async function loadPricing() {
  return import(path.join(REPO, 'substrate', 'lib', 'pricing.js'))
}

export function ledgerDir(root) { return path.join(root, 'ledger') }
export function indexPath(root) { return path.join(root, 'ledger', 'index.jsonl') }
export function runsDir(root) { return path.join(root, 'ledger', 'runs') }
export function runPath(root, id) { return path.join(root, 'ledger', 'runs', `${id}.json`) }

// A minimal, schema-shaped-enough LedgerEntry row for constructing index/run-file fixtures directly
// (this work item's tests never go through `ledger append`).
export function makeEntry(overrides) {
  const id = overrides.id ?? `${overrides.run_id}-${overrides.workflow}`
  return {
    id, run_id: overrides.run_id, workflow: overrides.workflow, status: 'ok',
    started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:05:00.000Z', wall_clock_sec: 300,
    result_ref: `ledger/runs/${id}.json`, artifact_count: 0, escalations: 0,
    provenance: { node: overrides.workflow, executor: 'ai_agent', method: 'hotl', run_id: overrides.run_id, created_at: '2026-01-01T00:00:00Z' },
    ...overrides, id,
  }
}

export function writeIndex(root, rows) {
  fs.mkdirSync(ledgerDir(root), { recursive: true })
  fs.writeFileSync(indexPath(root), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
}

export function writeRun(root, id, entry, result = {}) {
  fs.mkdirSync(runsDir(root), { recursive: true })
  fs.writeFileSync(runPath(root, id), JSON.stringify({ entry, result }, null, 2) + '\n')
}

export function readIndexRows(root) {
  if (!fs.existsSync(indexPath(root))) return []
  return fs.readFileSync(indexPath(root), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

export function readRun(root, id) {
  return JSON.parse(fs.readFileSync(runPath(root, id), 'utf8'))
}

// Every key present on either object must be deepStrictEqual across pre/post, except `allowedKey`
// (which must actually differ). Used to assert "the ONLY field that changed is cost_est_usd".
export function assertOnlyFieldChanged(assert, pre, post, allowedKey) {
  const keys = new Set([...Object.keys(pre), ...Object.keys(post)])
  for (const k of keys) {
    if (k === allowedKey) continue
    assert.deepStrictEqual(post[k], pre[k], `field ${k} must not change`)
  }
  assert.notDeepStrictEqual(post[allowedKey], pre[allowedKey], `field ${allowedKey} was expected to change`)
}
