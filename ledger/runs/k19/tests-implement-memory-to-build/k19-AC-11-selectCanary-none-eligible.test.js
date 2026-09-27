// spec-wi-b1-b2-memory-to-build AC-11. Written from the Spec only.
//
// "canaries in which none of the mutations contains a path-like token inside task.owned_surfaces
// (including canaries: [], undefined, null, or non-array)" / "selectCanary({ canaries, task, run_id })
// runs" / "it returns null without throwing"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSelectCanary } from './k19-canary-extract-helpers.js'

const task = { id: 't1', owned_surfaces: [{ kind: 'path', ref: '.claude/workflows/build-implement.js' }] }

test('AC-11: selectCanary returns null without throwing when no canary mutation names a path inside the task\'s owned surfaces', () => {
  const { selectCanary } = loadSelectCanary()
  const canaries = [
    { id: 'c1', mutation: 'in some/unrelated/file.js, break the thing' },
    { id: 'c2', mutation: 'in another/unowned/path.js, break it too' },
  ]
  let out
  assert.doesNotThrow(() => { out = selectCanary({ canaries, task, run_id: 'r1' }) })
  assert.equal(out, null)
})

test('AC-11: selectCanary returns null without throwing for canaries: [], undefined, null, or a non-array value', () => {
  const { selectCanary } = loadSelectCanary()
  for (const canaries of [[], undefined, null, {}, 'x']) {
    let out
    assert.doesNotThrow(() => { out = selectCanary({ canaries, task, run_id: 'r1' }) })
    assert.equal(out, null, `expected null for canaries=${JSON.stringify(canaries)}`)
  }
})
