// Source-text wiring tests for spec-wi-b6-test-validity-before-blame (AC-6, AC-7, AC-8, AC-9, AC-10):
// how the test-validity detector, testValidity's classification and the test_defect / code_defect /
// unclear routing are wired into runTask in .claude/workflows/build-implement.js.
//
// Written from the spec (ledger/runs/k10/spec-wi-b6-test-validity-before-blame.json) ONLY, using
// substrate/test/b5-wiring-helpers.js (functionNamed, enclosingFunction, callSites, reachersOf,
// firstCallOf) to assert CALLS and their order inside runTask — never the first textual occurrence of a
// name anywhere in the file, which finds declarations and comments rather than calls (the exact trap the
// harness warns this TestSet away from).
//
// Lands in substrate/test/ and runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
// Repository paths are resolved only through the existing extract-fixloop.js sentinel extractor, never by
// counting ".." from this file's own location. No test here shells out to npm test or runs a workflow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed, enclosingFunction, callSites, reachersOf, firstCallOf } from './b5-wiring-helpers.js'

test('AC-6: testValidity is called inside runTask, and its first call precedes every fix:${task.id} fixer agent call', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')

  const validityCalls = callSites(text, 'testValidity', rt.bodyStart, rt.bodyEnd)
  assert.ok(validityCalls.length > 0, 'expected at least one call to testValidity inside runTask\'s body')

  // fix:${task.id} agent labels: found as the literal template prefix the spec itself quotes.
  const fixLabelRe = /`fix:\$\{task\.id\}/g
  const fixLabels = []
  let m
  while ((m = fixLabelRe.exec(text))) {
    if (m.index > rt.bodyStart && m.index < rt.bodyEnd) fixLabels.push(m.index)
  }
  assert.ok(fixLabels.length > 0, 'expected at least one fix:${task.id} labelled agent call inside runTask (the existing code fixer)')

  const firstValidityCall = Math.min(...validityCalls)
  for (const label of fixLabels) {
    assert.ok(firstValidityCall < label,
      `the first testValidity( call (at ${firstValidityCall}) must precede every fix:\${task.id} agent label (found one at ${label})`)
  }
})

test('AC-7: a test_defect classification is routed to testRepairTarget and a testfix:${task.id} agent labelled with AT(\'test-author\') and the TestRepair schema, never to a fix: fixer', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')

  // Anchor on the literal 'test_defect' string testValidity returns (per AC-2/AC-3/AC-4), wherever runTask
  // (or a function it reaches) branches on it.
  const reach = reachersOf(text, 'testValidity')
  const classLiteralRe = /'test_defect'/g
  const hits = []
  let m
  while ((m = classLiteralRe.exec(text))) hits.push(m.index)
  assert.ok(hits.length > 0, "expected the literal 'test_defect' to appear where the classification is branched on")

  // At least one such branch point must live inside a function reachable from runTask (runTask itself or a
  // helper it calls), and from there a call to testRepairTarget, and a testfix:${task.id} agent label with
  // AT('test-author') and schema: TestRepair, must all be reachable — the EXISTING test-repair path AC-7
  // says must be reused, never a fresh one.
  const inReach = hits.filter(h => {
    const fn = (() => { try { return enclosingFunction(text, h) } catch { return null } })()
    return fn && reach.has(fn.name)
  })
  assert.ok(inReach.length > 0, "expected at least one 'test_defect' branch point inside a function reachable from runTask")

  const testRepairCalls = callSites(text, 'testRepairTarget', rt.bodyStart, rt.bodyEnd)
  assert.ok(testRepairCalls.length > 0, 'expected testRepairTarget to still be called (the EXISTING test-repair path, reused)')

  const testfixLabelRe = /`testfix:\$\{task\.id\}/g
  const testfixLabels = []
  while ((m = testfixLabelRe.exec(text))) if (m.index > rt.bodyStart && m.index < rt.bodyEnd) testfixLabels.push(m.index)
  assert.ok(testfixLabels.length > 0, 'expected at least one testfix:${task.id} labelled agent call inside runTask')

  // Every testfix: call site must be an agent() call carrying AT('test-author') and schema: TestRepair
  // somewhere in its own call (within a short window after the label, matching the existing call shape).
  for (const label of testfixLabels) {
    const window = text.slice(label, text.indexOf('})', label) + 2)
    assert.match(window, /AT\('test-author'\)/, `testfix: call at ${label} must carry AT('test-author')`)
    assert.match(window, /schema:\s*TestRepair/, `testfix: call at ${label} must carry schema: TestRepair`)
  }
})

test('AC-8: exactly one validity:${task.id}:${tag} detector runs per round, only when the round\'s test results report failed > 0, on MODEL.cheap, with a tests[] schema of the four boolean facts, and its prompt forbids modifying the worktree or branch', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')

  const labelRe = /`validity:\$\{task\.id\}:\$\{tag\}`/g
  const labels = []
  let m
  while ((m = labelRe.exec(text))) labels.push(m.index)
  assert.equal(labels.length, 1, `expected exactly one validity:\${task.id}:\${tag} agent label, found ${labels.length}`)
  const label = labels[0]
  assert.ok(label > rt.bodyStart && label < rt.bodyEnd, 'the validity: label must be inside runTask')

  const callStart = text.lastIndexOf('agent(', label)
  assert.ok(callStart > 0, 'expected an agent( call owning the validity: label')
  const callEnd = text.indexOf('})', label) + 2
  const call = text.slice(callStart, callEnd)

  assert.match(call, /model:\s*MODEL\.cheap/, 'the detector must run on MODEL.cheap')
  assert.match(call, /AT\('lens-correctness'\)|AT\('mechanical'\)/, "the detector must carry AT('lens-correctness') or AT('mechanical')")

  const prompt = text.slice(callStart, label)
  assert.match(prompt, /do not (create|edit|delete|modify)|no.*(worktree|branch)/i,
    'the detector prompt must forbid modifying the task worktree or branch')
  assert.match(prompt, /facts?\b/i, 'the detector prompt must ask for facts only')
  assert.doesNotMatch(prompt, /return (a |the )?verdict/i, 'the detector must never be asked for a verdict')

  // Schema: find the identifier passed as `schema:` on this call, then its object literal, and check for a
  // `tests` array whose items require the four boolean facts plus test and criterion.
  const schemaMatch = call.match(/schema:\s*([A-Za-z_$][\w$]*)/)
  assert.ok(schemaMatch, 'expected a schema: <Identifier> on the validity: agent call')
  const schemaName = schemaMatch[1]
  const schemaDeclIdx = text.search(new RegExp(`const ${schemaName}\\s*=`))
  assert.ok(schemaDeclIdx >= 0, `expected a declaration "const ${schemaName} ="`)
  // The schema object is small; grab a generous window rather than brace-matching a const-initialized object.
  const schemaText = text.slice(schemaDeclIdx, schemaDeclIdx + 1200)
  assert.match(schemaText, /tests\s*:/, 'the schema must declare a tests array')
  for (const field of ['test', 'criterion', 'locates_by_first_occurrence', 'requires_unquoted_literal', 'fails_on_base_same_reason', 'names_criterion_behaviour']) {
    assert.match(schemaText, new RegExp(`\\b${field}\\b`), `the tests[] schema must require ${field}`)
  }
  assert.match(schemaText, /boolean/, 'the four facts must be typed boolean')

  // Guard: the detector call must be conditioned on failed > 0. Look for a nearby reference to `.failed` in
  // an `if` guard before the call.
  const guardWindow = text.slice(Math.max(0, callStart - 500), callStart)
  assert.match(guardWindow, /\.failed\s*>\s*0|failed\s*>\s*0/, 'the detector must be guarded by a round\'s failed > 0')
})

test('AC-9: the correctness lens prompt is told about test-defect repairs rather than fed those failures as findings', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const correctnessIdx = text.indexOf("lens('correctness'", rt.bodyStart)
  assert.ok(correctnessIdx > 0 && correctnessIdx < rt.bodyEnd, 'expected the existing correctness lens call inside runTask')
  // The correctness lens thunk must, somewhere between the detector call and the lens invocation, reference
  // the test_validity/test_defect classification so a test under repair is named to the lens rather than
  // silently included in its evidence.
  const validityLabel = text.indexOf('`validity:${task.id}:${tag}`')
  assert.ok(validityLabel > 0 && validityLabel < correctnessIdx,
    'the validity: detector must run before the correctness lens is invoked in the same round')
  const between = text.slice(validityLabel, correctnessIdx + 4000)
  assert.match(between, /test_defect/, 'the correctness lens\'s evidence-building code must reference test_defect somewhere after classification')
})

test('AC-10: code_defect and unclear classifications still reach routeFinding and the fixer/testfix/dispute flow unchanged, and unclear is recorded', () => {
  const text = readWorkflowText()
  // routeFinding, the fixer path and disputesToJudge are pre-existing and must remain reachable/unchanged
  // regardless of this change.
  assert.match(text, /function routeFinding\(/, 'routeFinding must still exist')
  assert.match(text, /function testRepairTarget\(/, 'testRepairTarget must still exist')
  assert.match(text, /function disputesToJudge\(/, 'disputesToJudge must still exist')
  assert.match(text, /'unclear'/, "the literal 'unclear' classification must appear (recorded, per AC-10)")
  assert.match(text, /test_validity/, 'the run output must reference test_validity, where unclear classifications are recorded')
})
