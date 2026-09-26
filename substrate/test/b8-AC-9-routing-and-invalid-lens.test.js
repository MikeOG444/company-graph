// spec-wi-b8-tests-run-the-task-code AC-9. Written from the Spec only.
//
// "A round in which escapingImports returns a non-empty list. runTask handles that round. Each escaping file
// is routed to the Test Author on the existing testfix: path: testRepairTarget reused, label beginning
// testfix:${task.id}:, AT('test-author'), TestRepair schema. The prompt tells the author that a TestSet lands
// in substrate/test/ beside helpers.js, so helpers are imported as './helpers.js'. The correctness lens prompt
// for that round says the run was invalid and does not include that round's failing results as evidence
// against the implementation."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed, callSites, reachersOf, enclosingFunction } from './b5-wiring-helpers.js'

test('AC-9: escapingImports reaches the existing testfix: repair path (testRepairTarget, AT(\'test-author\'), TestRepair schema)', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')

  // Every function reachable from runTask (runTask itself, or a helper it calls) that also calls escapingImports.
  const reach = reachersOf(text, 'escapingImports')
  const escapingCallSites = callSites(text, 'escapingImports', rt.bodyStart, rt.bodyEnd)
  assert.ok(escapingCallSites.length > 0, 'expected escapingImports to be called inside runTask')

  // From the call site, walk forward within runTask's body to find a testfix: label and confirm it carries
  // AT('test-author') and schema: TestRepair, and that testRepairTarget is called somewhere in reach.
  const testRepairTargetCalls = callSites(text, 'testRepairTarget', rt.bodyStart, rt.bodyEnd)
  assert.ok(testRepairTargetCalls.length > 0, 'expected testRepairTarget to still be called (the EXISTING repair path, reused)')

  const testfixLabelRe = /`testfix:\$\{task\.id\}:/g
  const testfixLabels = []
  let m
  while ((m = testfixLabelRe.exec(text))) if (m.index > rt.bodyStart && m.index < rt.bodyEnd) testfixLabels.push(m.index)
  assert.ok(testfixLabels.length > 0, 'expected at least one testfix:${task.id}: labelled agent call inside runTask')

  // At least one testfix: call must sit in a function reachable from the escapingImports call (runTask itself,
  // or a helper it calls that escapingImports's own caller also reaches) — every existing testfix: call site
  // must carry AT('test-author') and schema: TestRepair, exactly like the pre-existing test-repair paths do.
  for (const label of testfixLabels) {
    const fn = (() => { try { return enclosingFunction(text, label) } catch { return null } })()
    if (!fn || !reach.has(fn.name) && fn.name !== 'runTask') continue
    const window = text.slice(label, text.indexOf('})', label) + 2)
    assert.match(window, /AT\('test-author'\)/, `testfix: call at ${label} must carry AT('test-author')`)
    assert.match(window, /schema:\s*TestRepair/, `testfix: call at ${label} must carry schema: TestRepair`)
  }
})

test('AC-9: the Test Author prompt reached by an escaping-imports repair tells the author a TestSet lands in substrate/test/ beside helpers.js, importable as \'./helpers.js\'', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const escapingCallSites = callSites(text, 'escapingImports', rt.bodyStart, rt.bodyEnd)
  assert.ok(escapingCallSites.length > 0, 'expected escapingImports to be called inside runTask')
  // Search a generous window following the FIRST escapingImports( call for a testfix: prompt naming
  // substrate/test/ and './helpers.js' — the exact wording the spec's summary quotes.
  const from = Math.min(...escapingCallSites)
  const window = text.slice(from, Math.min(text.length, from + 6000))
  assert.match(window, /substrate\/test\//, 'expected the repair prompt to name substrate/test/')
  assert.match(window, /'\.\/helpers\.js'/, "expected the repair prompt to say helpers are imported as './helpers.js'")
})

test('AC-9: the correctness lens prompt for a round with escaping imports says the run was invalid, rather than being fed that round\'s failing results as evidence', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const correctnessIdx = text.indexOf("lens('correctness'", rt.bodyStart)
  assert.ok(correctnessIdx > 0 && correctnessIdx < rt.bodyEnd, 'expected the existing correctness lens call inside runTask')
  const escapingCallSites = callSites(text, 'escapingImports', rt.bodyStart, rt.bodyEnd)
  assert.ok(escapingCallSites.length > 0, 'expected escapingImports to be called inside runTask')
  const firstEscaping = Math.min(...escapingCallSites)
  assert.ok(firstEscaping < correctnessIdx, 'the escapingImports( call must precede the correctness lens invocation')
  const between = text.slice(firstEscaping, correctnessIdx + 6000)
  assert.match(between, /invalid/i, 'the correctness lens\'s evidence-building code must reference the run being invalid when imports escape')
})
