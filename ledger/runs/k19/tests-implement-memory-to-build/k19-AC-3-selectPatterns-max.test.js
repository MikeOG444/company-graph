// spec-wi-b1-b2-memory-to-build AC-3. Written from the Spec only.
//
// "more than max valid patterns" / "selectPatterns(patterns, { max: 2 }) runs" / "exactly 2 items are
// returned, and they are the first 2 of the full ordering."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPatternFunctions } from './k19-patterns-extract-helpers.js'

const p = (id, kind, sample_size) => ({ id, kind, sample_size, claim: `claim-${id}` })

test('AC-3: selectPatterns(patterns, { max: 2 }) returns exactly 2 items, the first 2 of the full (unbounded) ordering', () => {
  const { selectPatterns } = loadPatternFunctions()
  const input = [
    p('b2', 'pattern', 1),
    p('a1', 'anti_pattern', 2),
    p('c3', 'prompt_refinement', 9),
    p('a2', 'anti_pattern', 2),
    p('b1', 'pattern', 5),
    p('a3', 'anti_pattern', 9),
  ]
  const full = selectPatterns(input, { max: 100 })
  const limited = selectPatterns(input, { max: 2 })
  assert.equal(limited.length, 2, `expected exactly 2 items, got ${limited.length}`)
  assert.deepEqual(limited, full.slice(0, 2), 'the first 2 of a max:2 call must equal the first 2 of the full ordering')
})
