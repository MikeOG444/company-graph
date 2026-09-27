// spec-wi-b1-b2-memory-to-build AC-12. Written from the Spec only.
//
// "a task whose owned_surfaces include '.claude/workflows/build-implement.js', and canaries where exactly
// two mutations name paths inside the owned surfaces and one names only a path outside them" /
// "selectCanary runs with a fixed run_id and task.id" / "it returns one of the two eligible canaries. The
// index is a deterministic hash of (run_id + ':' + task.id) modulo 2. Repeated calls with the same inputs
// return the same canary, and at least one pair of differing run_id values selects different eligible
// canaries."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSelectCanary } from './k19-canary-extract-helpers.js'

const task = { id: 'task-a', owned_surfaces: [{ kind: 'path', ref: '.claude/workflows/build-implement.js' }] }
const canaries = [
  { id: 'eligible-1', mutation: 'in .claude/workflows/build-implement.js, replace a needle with an undefined identifier' },
  { id: 'outside', mutation: 'in some/unowned/file.js, break it' },
  { id: 'eligible-2', mutation: 'in .claude/workflows/build-implement.js, drop a return statement' },
]
const eligibleIds = new Set(['eligible-1', 'eligible-2'])

test('AC-12: selectCanary returns one of the two eligible canaries (never the one naming only an unowned path)', () => {
  const { selectCanary } = loadSelectCanary()
  const out = selectCanary({ canaries, task, run_id: 'run-1' })
  assert.ok(out, 'expected a canary to be selected')
  assert.ok(eligibleIds.has(out.id), `expected an eligible canary, got ${out.id}`)
})

test('AC-12: selectCanary is deterministic — repeated calls with the same run_id and task.id return the same canary', () => {
  const { selectCanary } = loadSelectCanary()
  const a = selectCanary({ canaries, task, run_id: 'run-1' })
  const b = selectCanary({ canaries, task, run_id: 'run-1' })
  const c = selectCanary({ canaries, task, run_id: 'run-1' })
  assert.equal(a.id, b.id)
  assert.equal(b.id, c.id)
})

test('AC-12: at least one pair of differing run_id values selects different eligible canaries', () => {
  const { selectCanary } = loadSelectCanary()
  const seen = new Set()
  for (let i = 0; i < 50 && seen.size < 2; i++) {
    const out = selectCanary({ canaries, task, run_id: `run-${i}` })
    assert.ok(out && eligibleIds.has(out.id))
    seen.add(out.id)
  }
  assert.equal(seen.size, 2, 'expected both eligible canaries to be reachable across different run_id values')
})
