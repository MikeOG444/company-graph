// spec-wi-c15-c12-c14-line-guards AC-2. Written from the Spec only.
//
// "outputCeiling from the extracted block ... called as outputCeiling(1000000, 4), outputCeiling(600000, 4),
// outputCeiling(1000001, 4) and outputCeiling(700000, 3.5) ... returns 250000, 150000, 250000 and 200000
// respectively (Math.floor(billed / ratio))."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopFunctions } from './k21-fixloop-all.js'

test('AC-2: outputCeiling(billed, ratio) === Math.floor(billed / ratio) for the Spec\'s four examples', () => {
  const { fns } = loadAllFixLoopFunctions()
  assert.equal(fns.outputCeiling(1000000, 4), 250000)
  assert.equal(fns.outputCeiling(600000, 4), 150000)
  assert.equal(fns.outputCeiling(1000001, 4), 250000)
  assert.equal(fns.outputCeiling(700000, 3.5), 200000)
})
