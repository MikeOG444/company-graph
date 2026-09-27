// spec-wi-b1-b2-memory-to-build AC-13. Written from the Spec only.
//
// "canary entries missing id or mutation, or with a non-string mutation" / "selectCanary runs" / "those
// entries are ignored as ineligible and nothing throws"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSelectCanary } from './k19-canary-extract-helpers.js'

const task = { id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/workflows/build-implement.js' }] }

test('AC-13: selectCanary ignores canary entries missing id, missing mutation, or with a non-string mutation, without throwing', () => {
  const { selectCanary } = loadSelectCanary()
  const canaries = [
    { mutation: 'in .claude/workflows/build-implement.js, break it' }, // missing id
    { id: 'no-mutation' }, // missing mutation
    { id: 'bad-mutation', mutation: 42 }, // non-string mutation
    { id: 'bad-mutation-2', mutation: { path: '.claude/workflows/build-implement.js' } }, // non-string mutation
  ]
  let out
  assert.doesNotThrow(() => { out = selectCanary({ canaries, task, run_id: 'r1' }) })
  assert.equal(out, null, 'every entry is malformed, so no eligible canary exists')
})

test('AC-13: a well-formed canary survives alongside malformed neighbors', () => {
  const { selectCanary } = loadSelectCanary()
  const canaries = [
    { mutation: 'in .claude/workflows/build-implement.js, break it' }, // missing id
    { id: 'no-mutation' }, // missing mutation
    { id: 'good', mutation: 'in .claude/workflows/build-implement.js, drop a return' },
  ]
  let out
  assert.doesNotThrow(() => { out = selectCanary({ canaries, task, run_id: 'r1' }) })
  assert.ok(out)
  assert.equal(out.id, 'good')
})
