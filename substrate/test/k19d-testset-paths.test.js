// k19d: two fix-loop defects that made k19 escalate with a finished implementation.
// (1) The Test Runner reports an import's file relative to the TestSet ('x.test.js'), and escapingImports resolved
//     that bare name against '' — so every './helpers.js' read as escaping and every round was declared invalid;
//     the escape repair was then aimed at ${worktree}/x.test.js, so the Test Author wrote the TestSet onto the
//     task branch.
// (2) widenTestsRef accepted any path under the artifact dir, and a task worktree lives there too, so a repaired
//     copy on the task branch became the TestSet and each round ran just the last file touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'
import { functionNamed, callSites, matchBrace } from './b5-wiring-helpers.js'

const load = () => new Function(extractBlock(readWorkflowText()).block + '\nreturn { escapingImports, testSetFile, widenTestsRef }')()
const T = '.artifacts/tests/t1'

test('escapingImports: a bare or TestSet-relative file name is resolved inside the TestSet', () => {
  const { escapingImports } = load()
  for (const tests_ref of [T, `${T}/x.test.js`, `/home/u/cg/${T}`]) {
    assert.deepEqual(escapingImports({ tests_ref, imports: [
      { file: 'x.test.js', specifier: './helpers.js' },
      { file: 'extract-fixloop.js', specifier: './fixloop-helpers.js' },
      { file: 'sub/y.js', specifier: '../helpers.js' },
    ] }), [], `tests_ref ${tests_ref}`)
  }
  assert.deepEqual(escapingImports({ tests_ref: T, imports: [{ file: 'x.test.js', specifier: '../../../substrate/test/helpers.js' }] }),
    [{ file: 'x.test.js', specifier: '../../../substrate/test/helpers.js' }], 'a real escape from a bare name is still caught')
})

test('testSetFile keeps a path already in the TestSet and places a bare one inside it', () => {
  const { testSetFile } = load()
  assert.equal(testSetFile(T, 'x.test.js'), `${T}/x.test.js`)
  assert.equal(testSetFile(`${T}/a.test.js`, 'b.test.js'), `${T}/b.test.js`)
  assert.equal(testSetFile(T, `${T}/sub/y.js`), `${T}/sub/y.js`)
  assert.equal(testSetFile(T, `/home/u/cg/${T}/x.test.js`), `${T}/x.test.js`)
})

test('widenTestsRef: a worktree path never becomes the TestSet; a sibling of a single-file TestSet widens to its directory', () => {
  const { widenTestsRef } = load()
  assert.equal(widenTestsRef(T, '.artifacts/worktrees/t1/substrate/test/x.test.js'), T)
  assert.equal(widenTestsRef(T, '/home/u/cg/.artifacts/worktrees/t1/substrate/test'), T)
  assert.equal(widenTestsRef(`${T}/a.test.js`, `${T}/b.test.js`), T)
  assert.equal(widenTestsRef(`${T}/a.test.js`, `${T}/a.test.js`), `${T}/a.test.js`)
  assert.equal(widenTestsRef(T, '.artifacts/tests/t2'), '.artifacts/tests/t2', 'a new TestSet in the store still may')
})

test('the escape repair targets the file placed inside the TestSet, not a bare name', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const sites = callSites(text, 'testRepairTarget', rt.bodyStart, rt.bodyEnd)
  // testRepairTarget takes one object argument: the braces after '(' hold every field it is given.
  const argsOf = (at) => { const open = text.indexOf('{', at); return text.slice(open, matchBrace(text, open) + 1) }
  const escapeSite = sites.find(at => /location:\s*testSetFile\(/.test(argsOf(at)))
  assert.ok(escapeSite, 'a testRepairTarget call inside runTask must take its location from testSetFile(...)')
})
