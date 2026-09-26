// AC-8: changeScopedCriteria, called with [], undefined, or an acceptance array whose every THEN is
// behavioural (e.g. 'the function returns 3', 'the prompt names the file'), returns [] without throwing.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopDecisions } from './k17-helpers.js'

const crit = (id, then) => ({ id, given: 'the described precondition holds', when: 'the described action happens', then, testable: true })

test('AC-8: changeScopedCriteria returns [] for empty, undefined, or all-behavioural input', () => {
  const { changeScopedCriteria } = loadAllFixLoopDecisions()
  assert.deepEqual(changeScopedCriteria([]), [])
  assert.deepEqual(changeScopedCriteria(undefined), [])
  const behavioural = [
    crit('AC-1', 'the function returns 3'),
    crit('AC-2', 'the prompt names the file'),
  ]
  assert.deepEqual(changeScopedCriteria(behavioural), [])
})
