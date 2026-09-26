// k13d: a Test Author repair of one file inside the TestSet must not narrow the next round's run to that file.
// On k13 the B6 test_defect path (and resolveRound's own repair path) replaced tests_ref with the single repaired
// file, so 13 of 14 criteria went unrun for the rest of the loop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'
import { functionNamed, callSites } from './b5-wiring-helpers.js'

const load = () => new Function(extractBlock(readWorkflowText()).block + '\nreturn { widenTestsRef, resolveRound }')()

test('widenTestsRef keeps the TestSet directory when the repair is a file inside it', () => {
  const { widenTestsRef } = load()
  const dir = '.artifacts/tests/t1'
  assert.equal(widenTestsRef(dir, `${dir}/c5-AC-10.test.js`), dir)
  assert.equal(widenTestsRef(`${dir}/`, `${dir}/c5-AC-10.test.js`), `${dir}/`)
  assert.equal(widenTestsRef(dir, dir), dir)
  assert.equal(widenTestsRef(dir, '.artifacts/tests/t1-repair'), '.artifacts/tests/t1-repair', 'a sibling path is not inside')
  assert.equal(widenTestsRef(dir, '.artifacts/tests/other/x.test.js'), '.artifacts/tests/other/x.test.js')
  assert.equal(widenTestsRef(dir, undefined), dir)
  assert.equal(widenTestsRef(undefined, 'x.test.js'), 'x.test.js')
})

test('resolveRound keeps the TestSet directory after a repair of one file inside it', () => {
  const { resolveRound } = load()
  const dir = '.artifacts/tests/t1'
  const r = resolveRound({ findings: [], carried_in: [], deferred: [], rulings: [], tests_ref: dir,
    repairs: [{ dedupe_key: 'k', path: 'test', target_source: 'tests_ref', notes: 'repaired', tests_ref: `${dir}/c5-AC-10.test.js` }] })
  assert.equal(r.tests_ref, dir)
})

test('both places runTask reassigns ctx.testSet go through widenTestsRef', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const body = text.slice(rt.bodyStart, rt.bodyEnd)
  const assigns = [...body.matchAll(/ctx\.testSet = \{ \.\.\.ctx\.testSet, tests_ref: ([^}]*)\}/g)].map(m => m[1].trim())
  assert.ok(assigns.length >= 2)
  for (const a of assigns) assert.ok(/widenTestsRef\(|round\.tests_ref/.test(a), `unguarded tests_ref reassignment: ${a}`)
  const rr = functionNamed(text, 'resolveRound')
  assert.ok(callSites(text, 'widenTestsRef', rr.bodyStart, rr.bodyEnd).length, 'resolveRound must widen, not replace')
})
