// spec-wi-b8-tests-run-the-task-code AC-1. Written from the Spec only.
//
// "The text of .claude/workflows/build-implement.js. The block between the exact lines
// '// ---- BEGIN fix-loop decisions ----' and '// ---- END fix-loop decisions ----' is extracted with
// extractBlock from substrate/test/extract-fixloop.js and evaluated with
// new Function(block + 'return { escapingImports }'). escapingImports is a function. The block still
// evaluates without error, uses no import, require, fs, path module, Date.now or Math.random, and still
// exposes every existing decision function (the loadFixLoopDecisions call in substrate/test/extract-fixloop.js
// keeps working)."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadFixLoopDecisions } from './extract-fixloop.js'
import { fixLoopBlockText, loadEscapingImports } from './b8-escaping-imports-helpers.js'
import { codeMask } from './b5-wiring-helpers.js'

// k15d: CODE only. The k15 version matched the words anywhere, comments included, and integrate:resolve then
// reworded comments to satisfy it; the criterion means an import/require statement, not prose that names one.
const codeOnly = (text) => { const m = codeMask(text); return [...text].map((c, i) => (m[i] || c === '\n' ? c : ' ')).join('') }

const EXISTING_SEVENTEEN = [
  'scopeOf', 'scopeTargets', 'nextLenses', 'lensesToRun', 'roundBudget', 'taskCeiling', 'emptyDiffAction', 'shouldEscalate',
  'surfaceRef', 'withinOwned', 'boundaryCheck', 'criteriaScope', 'citedCriteria', 'isForeignCriterionFinding',
  'stripForeignFindings', 'routeFinding', 'fixOutcome',
]

test('AC-1: escapingImports is a function exposed by the fix-loop decisions sentinel block, evaluated exactly as the spec prescribes', () => {
  const escapingImports = loadEscapingImports()
  assert.equal(typeof escapingImports, 'function')
})

test('AC-1: the sentinel block uses no import, require, fs, path module, Date.now or Math.random', () => {
  const block = codeOnly(fixLoopBlockText())
  // "no import" / "no require": banned outright, in any form, so any actual import/require statement fails this.
  assert.doesNotMatch(block, /\bimport\s/, 'the block must not use import')
  assert.doesNotMatch(block, /\brequire\s*\(/, 'the block must not use require(...)')
  // "no fs" / "no path module": the block must never pull in Node's fs or path module. Since the block is
  // evaluated in isolation (new Function has no closure over anything outside it), the only way it could reach
  // either module is by importing/requiring it under its own or a re-exported name — already covered above — or
  // by naming the module specifier explicitly. Checking for a bare identifier called `fs` or `path` followed by
  // a `.` would also flag an unrelated local binding that merely happens to share that name (or prose like
  // "...not a path." in a comment), which is not what the criterion means by "uses the fs / path module".
  assert.doesNotMatch(block, /\bfs\s*=\s*require\s*\(\s*['"]node:fs['"]\s*\)/, 'the block must not require the fs module')
  assert.doesNotMatch(block, /\bpath\s*=\s*require\s*\(\s*['"]node:path['"]\s*\)/, 'the block must not require the path module')
  assert.doesNotMatch(block, /require\s*\(\s*['"](?:node:)?fs['"]\s*\)/, 'the block must not require the fs module')
  assert.doesNotMatch(block, /require\s*\(\s*['"](?:node:)?path['"]\s*\)/, 'the block must not require the path module')
  assert.doesNotMatch(block, /\bfrom\s+['"](?:node:)?fs['"]/, 'the block must not import the fs module')
  assert.doesNotMatch(block, /\bfrom\s+['"](?:node:)?path['"]/, 'the block must not import the path module')
  assert.doesNotMatch(block, /Date\.now\s*\(/, 'the block must not use Date.now()')
  assert.doesNotMatch(block, /Math\.random\s*\(/, 'the block must not use Math.random()')
})

test('AC-1: escapingImports runs to completion without a ReferenceError for fs/path, confirming it never actually reaches into the fs or path module at call time', () => {
  const escapingImports = loadEscapingImports()
  // A call whose inputs would exercise real path-escaping logic. If the implementation reached for Node's fs or
  // path module despite not importing it in this isolated scope, this call throws a ReferenceError rather than
  // returning a value - the isolated `new Function` block has no closure over anything outside it.
  assert.doesNotThrow(() => {
    escapingImports({
      tests_ref: '.artifacts/tests/t1',
      imports: [{ file: '.artifacts/tests/t1/x.test.js', specifier: '../../../substrate/test/helpers.js' }],
    })
  })
})

test('AC-1: the block still evaluates without error and still exposes every existing decision function (loadFixLoopDecisions keeps working)', () => {
  const decisions = loadFixLoopDecisions()
  for (const name of EXISTING_SEVENTEEN) {
    assert.equal(typeof decisions[name], 'function', `expected loadFixLoopDecisions() to still return ${name} as a function`)
  }
})
