// spec-wi-b1-b2-memory-to-build AC-10. Written from the Spec only.
//
// "build-implement.js source" / "the '// ---- BEGIN fix-loop decisions ----'..'// ---- END fix-loop
// decisions ----' block is extracted by the sentinel idiom and evaluated standalone" / "selectCanary is
// callable as a pure function. It uses withinOwned from the same block and references no Math.random,
// Date, args or agent."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'
import { loadSelectCanary } from './k19-canary-extract-helpers.js'
import { codeMask, functionNamed, callSites } from './b5-wiring-helpers.js'

const codeOnly = (text) => { const m = codeMask(text); return [...text].map((c, i) => (m[i] || c === '\n' ? c : ' ')).join('') }

test('AC-10: selectCanary is callable as a pure function once the fix-loop decisions block is extracted and evaluated standalone', () => {
  const { selectCanary } = loadSelectCanary()
  assert.equal(typeof selectCanary, 'function')
})

test('AC-10: selectCanary calls withinOwned, from the same sentinel block', () => {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block != null)
  const decl = functionNamed(block, 'selectCanary')
  const calls = callSites(block, 'withinOwned', decl.bodyStart, decl.bodyEnd)
  assert.ok(calls.length > 0, 'expected selectCanary to call withinOwned in its body')
})

test('AC-10: the fix-loop decisions block still contains no reference to Math.random, Date, args or agent', () => {
  const { block } = extractBlock(readWorkflowText())
  assert.ok(block != null)
  const code = codeOnly(block)
  assert.doesNotMatch(code, /Math\.random/, 'the block must not call Math.random')
  assert.doesNotMatch(code, /\bDate\b/, 'the block must not reference Date')
  assert.doesNotMatch(code, /\bargs\b/, 'the block must not reference args')
  assert.doesNotMatch(code, /\bagent\s*\(/, 'the block must not call agent(...)')
})
