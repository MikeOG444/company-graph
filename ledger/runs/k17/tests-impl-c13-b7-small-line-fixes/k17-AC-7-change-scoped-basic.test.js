// AC-7: changeScopedCriteria(acceptance), called with a plain acceptance array of contract-shaped criteria
// (AC-1 'every other ChangeSet property is unchanged', AC-2 'the returned list contains x.js', AC-3 'no
// other agent() site is added', AC-4 'the output is byte-identical to before', AC-5 'the file is
// unmodified'), returns the ids ['AC-1', 'AC-3', 'AC-4', 'AC-5'] in acceptance order, and does not include
// the behavioural AC-2.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

const crit = (id, then) => ({ id, given: 'the described precondition holds', when: 'the described action happens', then, testable: true })

test('AC-7: changeScopedCriteria lists only the change-scoped criteria, in acceptance order', () => {
  const { changeScopedCriteria } = loadAllFixLoopDecisions()
  const acceptance = [
    crit('AC-1', 'every other ChangeSet property is unchanged'),
    crit('AC-2', 'the returned list contains x.js'),
    crit('AC-3', 'no other agent() site is added'),
    crit('AC-4', 'the output is byte-identical to before'),
    crit('AC-5', 'the file is unmodified'),
  ]
  const result = changeScopedCriteria(acceptance)
  assert.deepEqual(result, ['AC-1', 'AC-3', 'AC-4', 'AC-5'])
})
