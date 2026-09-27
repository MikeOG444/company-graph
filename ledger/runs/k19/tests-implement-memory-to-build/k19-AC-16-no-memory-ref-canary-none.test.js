// spec-wi-b1-b2-memory-to-build AC-16. Written from the Spec only.
//
// "build-implement invoked with no args.memory_ref" / "the workflow runs" / "no memory-read agent call is
// made, canary behavior is identical to today (args.canary only), and tasks with no canary record
// canary_source 'none'"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'

test('AC-16: build-implement.js records canary_source \'none\' for a task with no canary', () => {
  const text = readWorkflowText()
  assert.match(text, /canary_source/, 'expected the run output to carry a canary_source field')
  assert.match(text, /canary_source[\s\S]{0,120}'none'|'none'[\s\S]{0,120}canary_source/,
    "expected a 'none' literal value associated with canary_source")
})
