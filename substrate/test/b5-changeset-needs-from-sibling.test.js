// Tests for spec-wi-b5-sibling-value-repair AC-14: contracts.schema.json's ChangeSet and the
// inlined ChangeSet schema in .claude/workflows/build-implement.js both gain an optional
// needs_from_sibling array field, with every other property, required entry and the Escalation
// reason enum unchanged.
//
// Written from the spec (ledger/runs/k8/spec-wi-b5-sibling-value-repair.json) ONLY.
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). Repository paths are resolved only through REPO as
// already exported by substrate/test/fixloop-helpers.js, never by counting ".." from this file's
// own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'
import { readWorkflowText } from './extract-fixloop.js'

function readSchema() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'contracts.schema.json'), 'utf8'))
}

test('AC-14: contracts.schema.json ChangeSet declares an optional needs_from_sibling array of { surface, what } objects', () => {
  const schema = readSchema()
  const cs = schema.$defs.ChangeSet
  assert.equal(cs.additionalProperties, false, 'ChangeSet must keep additionalProperties false')

  const field = cs.properties.needs_from_sibling
  assert.ok(field, 'expected a needs_from_sibling property on ChangeSet')
  assert.ok(!(cs.required ?? []).includes('needs_from_sibling'), 'needs_from_sibling must not be in ChangeSet.required')

  assert.equal(field.type, 'array', 'needs_from_sibling must be an array')
  const item = field.items
  assert.ok(item, 'expected needs_from_sibling.items to be defined')
  assert.equal(item.type, 'object')
  assert.equal(item.additionalProperties, false, 'each needs_from_sibling item must forbid additional properties')
  assert.deepEqual(item.required.slice().sort(), ['surface', 'what'].sort())
  assert.equal(item.properties.surface.type, 'string', 'surface must be a string (repository-relative path)')
  assert.equal(item.properties.what.type, 'string', 'what must be a string')
})

test('AC-14: every other ChangeSet property, its required list, and Escalation\'s five-value reason enum are unchanged', () => {
  const schema = readSchema()
  const cs = schema.$defs.ChangeSet

  const EXPECTED_PROPS = [
    'id', 'task_id', 'spec_id', 'worktree', 'base_commit', 'diff_ref', 'branch',
    'touched_surfaces', 'notes', 'revision', 'provenance', 'needs_from_sibling',
    // Added by spec-wi-b6-test-validity-before-blame (landed k11d): the fixer's own report of whether its fix changed behaviour.
    'behaviour_changed', 'behaviour_rationale',
  ]
  assert.deepEqual(Object.keys(cs.properties).sort(), EXPECTED_PROPS.sort())
  assert.deepEqual(
    cs.required.slice().sort(),
    ['id', 'worktree', 'base_commit', 'diff_ref', 'touched_surfaces', 'revision', 'provenance'].sort(),
  )

  assert.deepEqual(
    schema.$defs.Escalation.properties.reason.enum,
    ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro'],
  )
})

test('AC-14: the inlined ChangeSet schema in build-implement.js also declares an optional needs_from_sibling array field, shaped the same way', () => {
  const text = readWorkflowText()

  const csIdx = text.indexOf("const ChangeSet = { type: 'object'")
  assert.ok(csIdx >= 0, 'expected the existing inlined ChangeSet schema literal')
  const nextConstIdx = text.indexOf('const TestSet', csIdx)
  const window = nextConstIdx > csIdx ? text.slice(csIdx, nextConstIdx) : text.slice(csIdx, csIdx + 2000)

  assert.match(window, /needs_from_sibling/, 'expected needs_from_sibling declared on the inlined ChangeSet schema')
  assert.match(window, /diff_ref/, 'sanity: window must still contain the inlined ChangeSet\'s existing diff_ref property')
  assert.match(window, /touched_surfaces/, 'sanity: window must still contain the inlined ChangeSet\'s existing touched_surfaces property')

  // The field must not be added to the inlined schema's required list.
  const requiredMatch = window.match(/required:\s*\[[^\]]*\]/)
  assert.ok(requiredMatch, 'expected an inlined ChangeSet required: [...] list')
  assert.ok(!requiredMatch[0].includes('needs_from_sibling'), 'needs_from_sibling must not be in the inlined ChangeSet\'s required list')

  // The item shape near needs_from_sibling names both surface and what as strings.
  const needsIdx = window.indexOf('needs_from_sibling')
  const itemWindow = window.slice(needsIdx, needsIdx + 400)
  assert.match(itemWindow, /surface/i)
  assert.match(itemWindow, /what/i)
})
