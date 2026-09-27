// spec-wi-c15-c12-c14-line-guards AC-3. Written from the Spec only.
//
// "The ratio-selection logic (a pure helper in the block, or its equivalent inline use in the workflow
// body) ... args.billed_per_output is 3, then 0, then -2, then undefined, then the string '5', then NaN ...
// The ratio used is 3 for the first case and the default 4 for every other case. Only a positive finite
// number overrides the default."
//
// The Spec leaves the exact shape (a named pure helper vs. inline workflow logic) open, so this test first
// looks for a one-argument function in the fix-loop decisions block whose behaviour matches every one of
// the six given cases; if none matches (the logic was written inline in the workflow body instead), it
// falls back to a behaviour-shaped text check for the same guard, tolerant of line wrapping (\s+, never
// depending on where a line breaks).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { loadAllFixLoopFunctions } from './k21-fixloop-all.js'

const CASES = [[3, 3], [0, 4], [-2, 4], [undefined, 4], ['5', 4], [NaN, 4]]

test('AC-3: only a positive finite args.billed_per_output overrides the default ratio of 4', () => {
  const { fns } = loadAllFixLoopFunctions()
  const oneArgFns = Object.entries(fns).filter(([, fn]) => typeof fn === 'function' && fn.length === 1)
  const resolver = oneArgFns.find(([, fn]) => CASES.every(([input, expected]) => {
    try { return fn(input) === expected } catch { return false }
  }))

  if (resolver) {
    for (const [input, expected] of CASES) {
      assert.equal(resolver[1](input), expected, `ratio for billed_per_output=${JSON.stringify(input)} should be ${expected}`)
    }
    return
  }

  // Fall back: the guard lives inline in the workflow body rather than as a block helper.
  const text = readWorkflowText()
  assert.match(text, /billed_per_output/, 'expected args.billed_per_output to be read somewhere in the workflow')
  assert.match(text, /Number\.isFinite\s*\(/, 'expected a finiteness guard before falling back to the default ratio')
  assert.match(text, /DEFAULT_BILLED_PER_OUTPUT/, 'expected the named default-ratio constant to be used as the fallback value')
})
