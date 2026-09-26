// AC-9: changeScopedCriteria's phrase list is a copy of build-spec.js's PANEL_PATTERNS. Each of the six
// patterns (byte-identical, to before, changed path(s), '<noun> is/are added/removed/upgraded',
// unmodified, unchanged) exercised by a THEN containing its phrase is recognised by changeScopedCriteria.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

const crit = (id, then) => ({ id, given: 'the described precondition holds', when: 'the described action happens', then, testable: true })

test('AC-9: changeScopedCriteria recognises each of the six PANEL_PATTERNS phrases', () => {
  const { changeScopedCriteria } = loadAllFixLoopDecisions()
  const cases = [
    ['byte-identical', 'the output is byte-identical to the input'],
    ['to before', 'the value reverts to before'],
    ['changed path(s)', 'the changed paths list is empty'],
    ['<noun> is/are added/removed/upgraded', 'no dependency is added'],
    ['unmodified', 'the file is unmodified'],
    ['unchanged', 'the config is unchanged'],
  ]
  for (const [label, then] of cases) {
    const result = changeScopedCriteria([crit('AC-1', then)])
    assert.deepEqual(result, ['AC-1'], `expected the ${label} phrase to be classified as change-scoped`)
  }
})
