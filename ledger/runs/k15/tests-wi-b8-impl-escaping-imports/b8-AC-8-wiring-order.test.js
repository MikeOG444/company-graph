// spec-wi-b8-tests-run-the-task-code AC-8. Written from the Spec only.
//
// "The source of runTask in build-implement.js, analyzed with substrate/test/b5-wiring-helpers.js
// (functionNamed, callSites, firstCallOf). Call sites inside runTask are located. There is a call to
// escapingImports inside runTask whose arguments include the Test Runner result's imports. That call comes
// before the call that invokes the correctness lens (the lens('correctness', ...) call site) within the same
// round."
//
// Uses b5-wiring-helpers (functionNamed, callSites, firstCallOf) to find CALLS, never text.indexOf's first
// textual occurrence of a name — a call to escapingImports could otherwise be confused with its own
// declaration inside the fix-loop decisions sentinel block, which sits earlier in the file than runTask.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed, callSites, firstCallOf } from './b5-wiring-helpers.js'

test('AC-8: escapingImports is CALLED inside runTask, and that call precedes the correctness lens invocation in the same round', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')

  const escapingCalls = callSites(text, 'escapingImports', rt.bodyStart, rt.bodyEnd)
  assert.ok(escapingCalls.length > 0, 'expected at least one call to escapingImports inside runTask\'s body')

  // The correctness lens invocation: the existing lens('correctness', ...) call site.
  const correctnessCalls = callSites(text, 'lens', rt.bodyStart, rt.bodyEnd)
    .filter(i => text.startsWith("lens('correctness'", i))
  assert.ok(correctnessCalls.length > 0, 'expected the existing lens(\'correctness\', ...) call inside runTask')

  const firstEscaping = Math.min(...escapingCalls)
  const firstCorrectness = firstCallOf(text, ['lens'], rt.bodyStart, rt.bodyEnd) >= 0
    ? Math.min(...correctnessCalls)
    : -1
  assert.ok(firstCorrectness >= 0, 'expected to locate the correctness lens call')
  assert.ok(firstEscaping < firstCorrectness,
    `expected the escapingImports( call (at ${firstEscaping}) to precede the correctness lens invocation (at ${firstCorrectness})`)
})

test('AC-8: the escapingImports( call\'s arguments include the Test Runner result\'s imports', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const escapingCalls = callSites(text, 'escapingImports', rt.bodyStart, rt.bodyEnd)
  assert.ok(escapingCalls.length > 0, 'expected at least one call to escapingImports inside runTask')
  // Grab a generous window of each call's argument list (a fixed character span rather than paren-matching,
  // since arguments may themselves contain nested parens) and check at least one references `.imports` (the
  // property the Test Runner's TestResults now reports, per AC-7) rather than asserting one fixed variable name.
  const sawImportsArg = escapingCalls.some(at => {
    const window = text.slice(at, Math.min(text.length, at + 300))
    return /\.imports\b/.test(window) || /\bimports\s*[,:)]/.test(window)
  })
  assert.ok(sawImportsArg, 'expected at least one escapingImports( call to pass the Test Runner result\'s imports')
})
