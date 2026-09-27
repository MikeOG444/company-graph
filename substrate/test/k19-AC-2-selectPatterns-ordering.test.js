// spec-wi-b1-b2-memory-to-build AC-2. Written from the Spec only.
//
// "a patterns array that mixes kinds 'pattern', 'prompt_refinement' and 'anti_pattern' with various
// sample_size values and ids" / "selectPatterns(patterns) runs with the default options" / "it returns at
// most 5 items. Every 'anti_pattern' item comes before any other kind. Within each kind group, items are
// ordered by sample_size descending, then by id ascending. The input array is not mutated."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPatternFunctions } from './k19-patterns-extract-helpers.js'

const p = (id, kind, sample_size, claim = `claim-${id}`) => ({ id, kind, sample_size, claim })

test('AC-2: selectPatterns returns at most 5 items, anti_pattern first, then sample_size desc then id asc within each kind group, without mutating the input', () => {
  const { selectPatterns } = loadPatternFunctions()
  const input = [
    p('b2', 'pattern', 1),
    p('a1', 'anti_pattern', 2),
    p('c3', 'prompt_refinement', 9),
    p('a2', 'anti_pattern', 2),
    p('b1', 'pattern', 5),
    p('a3', 'anti_pattern', 9),
    p('c1', 'prompt_refinement', 1),
    p('b3', 'pattern', 5),
  ]
  const before = JSON.stringify(input)
  const out = selectPatterns(input)

  assert.ok(out.length <= 5, `expected at most 5 items, got ${out.length}`)

  const antiCount = input.filter(x => x.kind === 'anti_pattern').length
  const outAnti = out.slice(0, Math.min(antiCount, out.length))
  assert.ok(outAnti.every(x => x.kind === 'anti_pattern'), 'every anti_pattern item must come before any other kind')
  const firstNonAntiIdx = out.findIndex(x => x.kind !== 'anti_pattern')
  if (firstNonAntiIdx !== -1) {
    assert.ok(out.slice(firstNonAntiIdx).every(x => x.kind !== 'anti_pattern'),
      'no anti_pattern item may appear after a non-anti_pattern item')
  }

  // Within each kind group (in output order), sample_size descending then id ascending.
  const groups = new Map()
  out.forEach((x, i) => {
    if (!groups.has(x.kind)) groups.set(x.kind, [])
    groups.get(x.kind).push(x)
  })
  for (const [kind, items] of groups) {
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i]
      const ok = a.sample_size > b.sample_size || (a.sample_size === b.sample_size && a.id < b.id)
      assert.ok(ok, `within kind ${kind}, expected ${a.id}(n=${a.sample_size}) before ${b.id}(n=${b.sample_size}) by sample_size desc then id asc`)
    }
  }

  assert.equal(JSON.stringify(input), before, 'selectPatterns must not mutate its input array')
})
