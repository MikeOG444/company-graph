// Tests for spec-wi-b6-test-validity-before-blame AC-11 and AC-12: the new optional
// `test_validity` array on EvidenceBundle, and the new optional `behaviour_changed` /
// `behaviour_rationale` fields on ChangeSet, in BOTH contracts.schema.json and the inline
// contract in .claude/workflows/build-implement.js. Written from the spec ONLY.
//
// Uses the repo's OWN existing contract validator (substrate/lib/contracts.js's `validate`, the same
// one substrate/validator.js's CLI and other tests in this suite use) rather than hand-rolling an ajv
// setup, so "still validates" is checked against the real, live contracts.schema.json.
//
// Lands in substrate/test/ and runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
// Repository paths are resolved only through the existing extract-fixloop.js REPO export and
// substrate/lib/paths.js's own resolution, never by counting ".." from this file's own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkflowText } from './extract-fixloop.js'
import { REPO } from './fixloop-helpers.js'
import { validate } from '../lib/contracts.js'

function loadSchema() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'contracts.schema.json'), 'utf8'))
}

test('AC-12: contracts.schema.json\'s ChangeSet declares optional behaviour_changed (boolean) and behaviour_rationale (string), neither required, and a ChangeSet without them still validates', () => {
  const schema = loadSchema()
  const ChangeSet = schema.$defs.ChangeSet
  assert.ok(ChangeSet, 'expected $defs.ChangeSet in contracts.schema.json')
  assert.equal(ChangeSet.properties.behaviour_changed?.type, 'boolean', 'behaviour_changed must be typed boolean')
  assert.equal(ChangeSet.properties.behaviour_rationale?.type, 'string', 'behaviour_rationale must be typed string')
  assert.ok(!(ChangeSet.required ?? []).includes('behaviour_changed'), 'behaviour_changed must not be required')
  assert.ok(!(ChangeSet.required ?? []).includes('behaviour_rationale'), 'behaviour_rationale must not be required')

  const legacy = {
    id: 'cs1', worktree: 'toy', base_commit: 'abc123', diff_ref: '.artifacts/diffs/x.patch',
    touched_surfaces: [], revision: 0,
    provenance: { node: 'implementer', executor: 'ai_agent', method: 'hotl', model: 'sonnet', run_id: 'r1', created_at: '2026-01-01T00:00:00Z' },
  }
  const result = validate('ChangeSet', legacy)
  assert.ok(result.ok, `a legacy ChangeSet without behaviour_changed/behaviour_rationale must still validate: ${JSON.stringify(result.errors)}`)

  const withFields = { ...legacy, behaviour_changed: false, behaviour_rationale: 'renamed a variable, no behaviour change' }
  const result2 = validate('ChangeSet', withFields)
  assert.ok(result2.ok, `a ChangeSet WITH behaviour_changed/behaviour_rationale must validate: ${JSON.stringify(result2.errors)}`)
})

test('AC-12: the inline ChangeSet const in build-implement.js declares the same two optional fields, in the same optional (not required) position', () => {
  const text = readWorkflowText()
  const start = text.indexOf('const ChangeSet = {')
  assert.ok(start >= 0, 'expected the inline ChangeSet const')
  const end = text.indexOf('const TestSet = {', start)
  assert.ok(end > start, 'expected the next inline contract const (TestSet) to bound the ChangeSet block')
  const block = text.slice(start, end)
  assert.match(block, /behaviour_changed:\s*\{\s*type:\s*'boolean'/, "inline ChangeSet must declare behaviour_changed: { type: 'boolean' }")
  assert.match(block, /behaviour_rationale:\s*\{\s*type:\s*'string'/, "inline ChangeSet must declare behaviour_rationale: { type: 'string' }")
  const requiredMatch = block.match(/required:\s*\[([^\]]*)\]/)
  assert.ok(requiredMatch, 'expected a required: [...] list on the inline ChangeSet')
  assert.ok(!requiredMatch[1].includes('behaviour_changed'), 'behaviour_changed must not be in the inline required list')
  assert.ok(!requiredMatch[1].includes('behaviour_rationale'), 'behaviour_rationale must not be in the inline required list')
})

test('AC-11: contracts.schema.json\'s EvidenceBundle declares an optional test_validity array of {test, criterion, facts, class}, with class enum [\'test_defect\',\'code_defect\',\'unclear\'] and additionalProperties false', () => {
  const schema = loadSchema()
  const EvidenceBundle = schema.$defs.EvidenceBundle
  assert.ok(EvidenceBundle, 'expected $defs.EvidenceBundle')
  const tv = EvidenceBundle.properties.test_validity
  assert.ok(tv, 'expected EvidenceBundle.properties.test_validity')
  assert.equal(tv.type, 'array')
  assert.ok(!(EvidenceBundle.required ?? []).includes('test_validity'), 'test_validity must not be required')
  const item = tv.items
  assert.equal(item.additionalProperties, false, 'test_validity items must have additionalProperties: false')
  for (const key of ['test', 'criterion', 'facts', 'class']) {
    assert.ok(item.properties?.[key], `test_validity items must declare ${key}`)
  }
  assert.deepEqual(item.properties.class.enum?.slice().sort(), ['code_defect', 'test_defect', 'unclear'].sort())
})

test('AC-11: an EvidenceBundle with an empty test_validity array, and one with a populated classification, both validate; test_validity is [] when nothing was classified', () => {
  const base = {
    release_candidate_id: 'rc1', project_id: 'p1', iteration: 1, artifact_ref: 'integrate/rc1',
    specs: [], panel_results: [], suite: { passed: 1, failed: 0, results_ref: '.artifacts/results/x.json' }, escalations: [],
    provenance: { node: 'integrator', executor: 'ai_agent', method: 'hotl', model: 'sonnet', run_id: 'r1', created_at: '2026-01-01T00:00:00Z' },
  }
  const emptyResult = validate('EvidenceBundle', { ...base, test_validity: [] })
  assert.ok(emptyResult.ok, `empty test_validity must validate: ${JSON.stringify(emptyResult.errors)}`)

  const populated = {
    ...base,
    test_validity: [{
      test: 'AC-2', criterion: 'AC-2',
      facts: { locates_by_first_occurrence: true, requires_unquoted_literal: false, fails_on_base_same_reason: false, names_criterion_behaviour: true },
      class: 'test_defect',
    }],
  }
  const populatedResult = validate('EvidenceBundle', populated)
  assert.ok(populatedResult.ok, `a populated test_validity entry must validate: ${JSON.stringify(populatedResult.errors)}`)

  const badClass = { ...base, test_validity: [{ test: 't', criterion: 'c', facts: {}, class: 'bogus' }] }
  assert.ok(!validate('EvidenceBundle', badClass).ok, 'an invalid class value must fail validation')
})
