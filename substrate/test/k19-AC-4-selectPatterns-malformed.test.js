// spec-wi-b1-b2-memory-to-build AC-4. Written from the Spec only.
//
// "a patterns input with entries missing id, entries missing claim, null or non-object entries, or a
// non-array value (undefined, null, an object)" / "selectPatterns runs" / "it does not throw. Malformed
// entries are dropped. A non-array input yields []."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPatternFunctions } from './k19-patterns-extract-helpers.js'

test('AC-4: selectPatterns drops malformed entries (missing id, missing claim, null, non-object) without throwing', () => {
  const { selectPatterns } = loadPatternFunctions()
  const input = [
    { kind: 'pattern', sample_size: 3, claim: 'no id' },
    { id: 'p2', kind: 'pattern', sample_size: 3 },
    null,
    'not-an-object',
    42,
    { id: 'p3', kind: 'pattern', sample_size: 4, claim: 'valid' },
  ]
  let out
  assert.doesNotThrow(() => { out = selectPatterns(input) })
  assert.ok(Array.isArray(out))
  assert.ok(out.every(x => typeof x.id === 'string' && typeof x.claim === 'string'),
    'every surviving item must carry both id and claim')
  assert.ok(out.some(x => x.id === 'p3'), 'the one well-formed entry must survive')
  assert.equal(out.length, 1, 'only the well-formed entry should survive')
})

test('AC-4: selectPatterns never throws on a non-array input, and returns [] for one', () => {
  const { selectPatterns } = loadPatternFunctions()
  for (const bad of [undefined, null, {}, {}, 'x', 5]) {
    let out
    assert.doesNotThrow(() => { out = selectPatterns(bad) })
    assert.deepEqual(out, [], `selectPatterns(${JSON.stringify(bad)}) must return []`)
  }
})
