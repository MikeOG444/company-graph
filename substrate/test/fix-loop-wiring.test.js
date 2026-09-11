// Text-level checks for spec-wi-opp-p5-4: how the fix-loop decisions are wired into
// build-implement.js and fixer.md, and that the untouched Escalation contract stays
// untouched. Written from the spec only. Lands in substrate/test/ and runs under the
// repo's `npm test` (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { REPO } from './fixloop-helpers.js'
import { readWorkflowText, FIXER_MD_PATH } from './extract-fixloop.js'

test('AC-14: the scope: slicer is wired in after shouldEscalate is checked, in the fail branch, and round 1 still starts with every lens', () => {
  const text = readWorkflowText()

  const scopeLabelMatches = [...text.matchAll(/scope:/g)]
  assert.equal(scopeLabelMatches.length, 1, 'exactly one agent label starting "scope:" should exist')

  const escalateIdx = text.indexOf('const reason = shouldEscalate(')
  assert.ok(escalateIdx >= 0, 'expected the exact call site "const reason = shouldEscalate("')
  assert.ok(
    scopeLabelMatches[0].index > escalateIdx,
    'the scope: slicer must live after the escalation return, inside the fail branch, so a passing round never invokes it',
  )

  assert.match(
    text,
    /toRun\s*[:=]\s*(?:\[\s*\.\.\.\s*)?LENSES\b/,
    'the loop context must still initialize toRun to the full three-lens list, unchanged for round 1',
  )
})

test('AC-15: scoped_diff_ref threads from the workflow into fixer.md, with a fallback path, and the Test Author repair prompt is left untouched', () => {
  const workflowText = readWorkflowText()
  const fixerText = fs.readFileSync(FIXER_MD_PATH, 'utf8')

  assert.ok(workflowText.includes('scoped_diff_ref'), 'the code fixer prompt in the workflow must carry scoped_diff_ref')
  assert.ok(fixerText.includes('scoped_diff_ref'), 'fixer.md must document the new scoped_diff_ref input')
  assert.match(fixerText, /read.*(slice|scoped)/i, 'fixer.md must instruct reading the scoped slice first')
  assert.match(fixerText, /widen|fall\s*back|insufficient/i, 'fixer.md must say to widen only if the slice is insufficient')

  // A fallback branch must exist for a finding with no usable slice (location not a
  // file path, or slicing returned nothing).
  assert.match(
    workflowText,
    /fallback|unscoped|no slice|not a file/i,
    'the workflow must fall back to unscoped wording when a location is not a file path or slicing returns nothing',
  )

  // The Test Author's repair prompt must not carry scoped_diff_ref.
  //
  // This assertion was rewritten after run t4i escalated on it. The original scanned every
  // /test[-_ ]?author/gi match (9 in the file, including the bare AT('test-author') binding) and asserted
  // scoped_diff_ref did not appear within a -500/+1000 CHARACTER window of each. That measures FILE LAYOUT,
  // not behaviour: it failed because an unrelated AT('test-author') sat 347 characters before a
  // scoped_diff_ref literal belonging to a DIFFERENT prompt, while the contract it stands for was satisfied
  // the whole time. Three fix rounds and ~$2.72 went into a proximity artefact. The contract is now asserted
  // where it lives — in the repair prompt's own text — so the test fails when the behaviour is wrong and not
  // when the code moves.
  const repairPrompt = extractTestRepairPrompt(workflowText)
  assert.ok(repairPrompt, 'expected to find the Test Author repair prompt (the agent() call labelled testfix:)')
  assert.ok(
    !repairPrompt.includes('scoped_diff_ref'),
    'the test-repair prompt handed to the Test Author must carry no scoped_diff_ref',
  )
  assert.match(repairPrompt, /do not read or modify|tests? you wrote|repair the test/i,
    'the repair prompt must still be the test-repair prompt, not some other agent call')
})

// Returns the source text of the agent() call whose label starts with `testfix:` — the Test Author's
// repair invocation — from its `agent(` through the matching close of its options object. Anchored on the
// label, which is a stable identifier, rather than on where the call happens to sit in the file.
function extractTestRepairPrompt(workflowText) {
  const label = workflowText.indexOf('`testfix:')
  if (label === -1) return null
  // Walk back to the agent( that owns this label.
  const start = workflowText.lastIndexOf('agent(', label)
  if (start === -1) return null
  return workflowText.slice(start, label)
}

test('AC-17: contracts.schema.json is untouched by the cost-stop change — the Escalation.reason enum still has exactly its five existing values', () => {
  const schema = JSON.parse(fs.readFileSync(`${REPO}/contracts.schema.json`, 'utf8'))
  const reasonEnum = schema.$defs.Escalation.properties.reason.enum
  assert.deepEqual(reasonEnum, ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro'])
})
