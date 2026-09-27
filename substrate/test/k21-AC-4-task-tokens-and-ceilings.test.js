// spec-wi-c15-c12-c14-line-guards AC-4. Written from the Spec only.
//
// "The default task budget is 1000000 (billed), not 250000. The task and round ceilings placed on
// ctx.task_tokens and ctx.round_tokens are output-unit values produced by outputCeiling from the billed
// taskCeiling/roundBudget results (work_item_budgets[*].tokens, budget.task_tokens and budget.round_tokens
// are each treated as billed). With no budget args and no billed_per_output, ctx.task_tokens equals 250000,
// exactly as before."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, loadFixLoopDecisions, extractBlock } from './extract-fixloop.js'
import { loadAllFixLoopFunctions } from './k21-fixloop-all.js'
import { callSites, enclosingFunction } from './b5-wiring-helpers.js'

test('AC-4: TASK_TOKENS defaults to 1000000 billed tokens, not 250000', () => {
  const text = readWorkflowText()
  const m = text.match(/const\s+TASK_TOKENS\s*=[^\n]*/)
  assert.ok(m, 'expected a TASK_TOKENS constant declaration')
  assert.match(m[0], /1000000/, `expected TASK_TOKENS to default to 1000000, found: ${m[0]}`)
  assert.doesNotMatch(m[0], /\b250000\b/, `TASK_TOKENS must no longer default to 250000 billed, found: ${m[0]}`)
})

test('AC-4: composing taskCeiling with outputCeiling at the default ratio, with no overrides, yields the pre-existing 250000 output-token ceiling', () => {
  const { taskCeiling } = loadFixLoopDecisions()
  const { fns } = loadAllFixLoopFunctions()
  const billed = taskCeiling({ tasks_for_work_item: 1, default_task_tokens: 1000000 })
  assert.equal(billed, 1000000, 'taskCeiling with no work-item override should return the default_task_tokens it was given')
  assert.equal(fns.outputCeiling(billed, 4), 250000, 'outputCeiling(1000000, 4) must equal 250000')
})

test("AC-4: the workflow body feeds taskCeiling's and roundBudget's results into outputCeiling before they reach ctx", () => {
  // The Spec says the per-task and per-round ceilings are "output-unit values produced by outputCeiling from
  // the billed taskCeiling/roundBudget results". That composition can be written either as a direct nested
  // call (`outputCeiling(taskCeiling(...), ratio)`) or, just as legitimately, as an intermediate variable
  // (`const billed = taskCeiling(...); const ceiling = outputCeiling(billed, ratio)`). A test that only
  // recognises the nested-call form (or that anchors to the first textual occurrence of one particular
  // assignment target, e.g. `ctx.task_tokens =`) would fail correct code that happens to use the other form,
  // or code where that isn't the first such assignment in the file. This test instead follows the data flow:
  // for each call to the billed function, find the variable its result is bound to (directly, or via a call
  // nested in outputCeiling's own argument), then confirm that same variable — or the nested call itself —
  // reaches a call to outputCeiling within the same enclosing function.
  const text = readWorkflowText()
  const { block } = extractBlock(text)
  assert.ok(block != null, 'expected the fix-loop decisions sentinel block to be present')
  const blockStart = text.indexOf(block)
  const blockEnd = blockStart + block.length

  // Calls in the workflow body only: before the sentinel block starts, or after it ends (the block itself
  // only *defines* these functions, via `new Function`, and never calls them).
  const bodyCallSites = (name) =>
    [...callSites(text, name, 0, blockStart), ...callSites(text, name, blockEnd, text.length)]

  const outputCeilingSites = bodyCallSites('outputCeiling')
  assert.ok(outputCeilingSites.length, 'expected at least one call to outputCeiling in the workflow body')

  for (const billedFn of ['taskCeiling', 'roundBudget']) {
    const billedFnSites = bodyCallSites(billedFn)
    assert.ok(billedFnSites.length, `expected at least one call to ${billedFn} in the workflow body`)

    const feeds = billedFnSites.some((bf) => {
      // Direct nesting: an outputCeiling call site sits shortly after this billedFn call, with the billedFn
      // call inside outputCeiling's own argument list (outputCeiling( ... taskCeiling( ... ) ... )).
      const directlyNested = outputCeilingSites.some((oc) => oc < bf && bf < oc + 200)
      if (directlyNested) return true

      // Variable indirection: `const NAME = ...taskCeiling(...)` immediately assigns the call's result, and
      // `outputCeiling(NAME` appears afterwards, within the same enclosing function when one can be found
      // (falling back to a generous same-statement-group window otherwise).
      const before = text.slice(Math.max(0, bf - 80), bf)
      const nameMatch = before.match(/const\s+([A-Za-z_$][\w$]*)\s*=[^=]*$/)
      if (!nameMatch) return false
      const varName = nameMatch[1]

      let searchEnd
      try {
        searchEnd = enclosingFunction(text, bf).bodyEnd
      } catch {
        searchEnd = Math.min(text.length, bf + 2000)
      }
      const forwardCallRe = new RegExp(`outputCeiling\\s*\\(\\s*${varName}\\b`)
      return forwardCallRe.test(text.slice(bf, searchEnd))
    })

    assert.ok(feeds, `expected ${billedFn}'s result to reach a call to outputCeiling, directly or via a variable`)
  }
})
