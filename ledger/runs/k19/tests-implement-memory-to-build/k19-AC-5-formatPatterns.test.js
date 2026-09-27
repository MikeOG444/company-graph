// spec-wi-b1-b2-memory-to-build AC-5. Written from the Spec only.
//
// "selected patterns [{id:'p1', sample_size:4, claim:'X'}, {id:'p2', sample_size:2, claim:'Y'}]" /
// "formatPatterns(selected) runs" / "it returns exactly 'p1 (n=4): X\np2 (n=2): Y', one line per pattern
// in the form '<id> (n=<sample_size>): <claim>'. formatPatterns([]) returns ''."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPatternFunctions } from './k19-patterns-extract-helpers.js'

test('AC-5: formatPatterns renders one "<id> (n=<sample_size>): <claim>" line per pattern, joined by \\n', () => {
  const { formatPatterns } = loadPatternFunctions()
  const selected = [{ id: 'p1', sample_size: 4, claim: 'X' }, { id: 'p2', sample_size: 2, claim: 'Y' }]
  assert.equal(formatPatterns(selected), 'p1 (n=4): X\np2 (n=2): Y')
})

test('AC-5: formatPatterns([]) returns an empty string', () => {
  const { formatPatterns } = loadPatternFunctions()
  assert.equal(formatPatterns([]), '')
})
