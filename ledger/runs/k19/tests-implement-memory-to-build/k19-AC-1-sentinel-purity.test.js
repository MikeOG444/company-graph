// spec-wi-b1-b2-memory-to-build AC-1. Written from the Spec only.
//
// "the sentinel-extraction idiom pulls the block holding selectPatterns/formatPatterns (either the
// existing graph-lint block or a new memory-patterns block) and evaluates it standalone" / "selectPatterns
// and formatPatterns are callable as pure functions with no reference to args, agent, fs, Date or
// Math.random".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractPatternsBlock, loadPatternFunctions } from './k19-patterns-extract-helpers.js'
import { codeMask } from './b5-wiring-helpers.js'

const codeOnly = (text) => { const m = codeMask(text); return [...text].map((c, i) => (m[i] || c === '\n' ? c : ' ')).join('') }

test('AC-1: selectPatterns and formatPatterns are callable as pure functions once the sentinel block is extracted and evaluated standalone', () => {
  const { selectPatterns, formatPatterns } = loadPatternFunctions()
  assert.equal(typeof selectPatterns, 'function')
  assert.equal(typeof formatPatterns, 'function')
})

test('AC-1: the extracted block (either the graph-lint or a new memory-patterns sentinel block) contains no reference to args, agent, fs, Date or Math.random', () => {
  const { block, which } = extractPatternsBlock(readWorkflowText())
  assert.ok(block != null, 'expected a graph-lint or memory-patterns sentinel block to be found')
  const code = codeOnly(block)
  assert.doesNotMatch(code, /\bargs\b/, `${which} block must not reference args`)
  assert.doesNotMatch(code, /\bagent\s*\(/, `${which} block must not call agent(...)`)
  assert.doesNotMatch(code, /\bfs\b/, `${which} block must not reference fs`)
  assert.doesNotMatch(code, /\bDate\b/, `${which} block must not reference Date`)
  assert.doesNotMatch(code, /Math\.random/, `${which} block must not call Math.random`)
})

test('AC-1: selectPatterns/formatPatterns run to completion without a ReferenceError for args/agent/fs/Date, confirming the isolated block never actually reaches outside itself at call time', () => {
  const { selectPatterns, formatPatterns } = loadPatternFunctions()
  assert.doesNotThrow(() => formatPatterns(selectPatterns([{ id: 'p1', sample_size: 3, claim: 'X', kind: 'pattern' }])))
})
