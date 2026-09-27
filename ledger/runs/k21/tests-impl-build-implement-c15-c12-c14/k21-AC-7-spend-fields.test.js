// spec-wi-c15-c12-c14-line-guards AC-7. Written from the Spec only.
//
// "spend.tokens is still the output-token delta budget.spent() - TOKENS_AT_START. spend additionally
// carries billed_per_output (the ratio used) and billed_tokens_est (spend.tokens x billed_per_output,
// rounded to an integer). The args header comment documents that the three budget args are in billed units
// and documents args.billed_per_output."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'

test('AC-7: the run output\'s spend field keeps tokens (output-token delta) and gains billed_per_output and billed_tokens_est', () => {
  const text = readWorkflowText()
  const spendIdx = text.indexOf('spend:')
  assert.ok(spendIdx >= 0, 'expected a spend: field in the run output')
  const window = text.slice(spendIdx, spendIdx + 500)
  assert.match(window, /tokens\s*:/, 'expected spend.tokens to still be present')
  assert.match(window, /billed_per_output\s*:/, 'expected spend.billed_per_output')
  assert.match(window, /billed_tokens_est\s*:/, 'expected spend.billed_tokens_est')
})

test('AC-7: spend.tokens is still budget.spent() minus TOKENS_AT_START', () => {
  const text = readWorkflowText()
  const spendIdx = text.indexOf('spend:')
  const window = text.slice(spendIdx, spendIdx + 500)
  assert.match(window, /budget\.spent\(\s*\)\s*-\s*TOKENS_AT_START/, 'expected spend.tokens to remain budget.spent() - TOKENS_AT_START')
})

test('AC-7: the header documents the budget args as billed units and documents args.billed_per_output', () => {
  const text = readWorkflowText()
  assert.match(text, /billed_per_output/, 'expected billed_per_output documented somewhere in the workflow (the header or its usage)')
  // Look for a comment (not code) mentioning "billed" near the top of the file, where the args contract is
  // documented, per the repo's existing convention of a header comment describing `args`.
  const headerWindow = text.slice(0, 6000)
  const billedCommentLines = headerWindow.split('\n').filter((l) => /^\s*\/\//.test(l) && /billed/i.test(l))
  assert.ok(billedCommentLines.length > 0, 'expected at least one header comment line documenting billed units for the budget args')
})
