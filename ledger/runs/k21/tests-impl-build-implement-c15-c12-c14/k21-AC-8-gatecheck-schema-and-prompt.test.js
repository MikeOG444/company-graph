// spec-wi-c15-c12-c14-line-guards AC-8. Written from the Spec only.
//
// "The GateCheck schema in build-implement.js ... has a string property id, and 'id' is in its required
// list alongside found, status, gate and option. The gate:spec_gate prompt explicitly asks for the record's
// id and its gate type as two separate fields, and says they are different values."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { callSites } from './b5-wiring-helpers.js'
import { callOwning } from './k21-call-span-helper.js'

test('AC-8: the inline GateCheck const declares a string id, required alongside found, status, gate and option', () => {
  const text = readWorkflowText()
  const start = text.indexOf('const GateCheck = {')
  assert.ok(start >= 0, 'expected the inline GateCheck const')
  const end = text.indexOf('\nconst ', start + 1)
  const block = text.slice(start, end > start ? end : start + 1500)
  assert.match(block, /id\s*:\s*\{\s*type\s*:\s*'string'/, "expected GateCheck.id: { type: 'string' }")
  const requiredMatch = block.match(/required\s*:\s*\[([^\]]*)\]/)
  assert.ok(requiredMatch, 'expected a required: [...] list on the inline GateCheck')
  for (const field of ['id', 'found', 'status', 'gate', 'option']) {
    assert.match(requiredMatch[1], new RegExp(`['"\`]${field}['"\`]`), `expected ${field} in GateCheck's required list`)
  }
})

test('AC-8: the gate:spec_gate prompt asks for the record\'s id and its gate type as two separate fields, and says they differ', () => {
  const text = readWorkflowText()
  const labelIdx = text.search(/['"`]gate:spec_gate['"`]/)
  assert.ok(labelIdx >= 0, 'expected a gate:spec_gate label')
  const owning = callOwning(text, callSites, 'agent', labelIdx, 0, text.length)
  assert.ok(owning, 'expected an agent() call (found via callSites, not indexOf) whose arguments contain the gate:spec_gate label')
  const prompt = text.slice(owning.argsStart, owning.end)
  assert.match(prompt, /\bid\b/, 'expected the prompt to ask for the record\'s id')
  assert.match(prompt, /\bgate\b/, 'expected the prompt to ask for the gate type')
  // The Spec says the prompt "says they are different values" without quoting exact wording, so accept
  // any phrasing that asserts id and gate must not be the same (e.g. "different", "distinct", or a
  // negation like "never the same value" / "not the same"), not only the literal words "differ"/"distinct".
  assert.match(
    prompt,
    /\bdiffer(?:ent|s)?\b|\bdistinct\b|\b(?:not|never)\b[^.]{0,40}\bsame\b/i,
    'expected the prompt to say id and gate are different values'
  )
})
