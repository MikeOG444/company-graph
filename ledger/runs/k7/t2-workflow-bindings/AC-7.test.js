// AC-7 (spec-wi-a5-agent-least-privilege): "any workflow script and args carrying missing_agent_types:
// ['x'] for a type its runtime has not yet registered ... AT('x') yields {} while AT of every other type
// still yields { agentType: ... }, in all nine workflows including maintain-triage.js (whose NEW() helper
// folds into AT() while 'new_agent_types: false' keeps dropping exactly the four types it covered), and
// the test asserts each workflow's helper reads both A.agent_types and A.missing_agent_types."
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllWorkflows, readWorkflow, loadHelperFactory } from './binding-helpers.js'

test('AC-7: every workflow declares an AT() helper that reads A.agent_types and A.missing_agent_types', () => {
  for (const { file, text } of readAllWorkflows()) {
    const h = loadHelperFactory(text)
    assert.ok(h.hasAT, `${file} must declare a const AT = ... helper`)
    assert.ok(/A\.agent_types/.test(text), `${file}'s helper must read A.agent_types`)
    assert.ok(/A\.missing_agent_types/.test(text), `${file}'s helper must read A.missing_agent_types`)
  }
})

test('AC-7: AT(x) yields {} for a type named in missing_agent_types, and { agentType } for every other type', () => {
  for (const { file, text } of readAllWorkflows()) {
    const { hasAT, make } = loadHelperFactory(text)
    if (!hasAT) continue // reported as a failure by the declaration test above
    const { AT } = make({ missing_agent_types: ['zz-dropped-type'] })
    assert.deepEqual(AT('zz-dropped-type'), {}, `${file}: AT() must drop exactly the type named in missing_agent_types`)
    assert.deepEqual(AT('zz-kept-type'), { agentType: 'zz-kept-type' }, `${file}: AT() must still bind a type NOT named in missing_agent_types`)
  }
})

test('AC-7: with no missing_agent_types at all, AT(x) yields { agentType: x } for any type', () => {
  for (const { file, text } of readAllWorkflows()) {
    const { hasAT, make } = loadHelperFactory(text)
    if (!hasAT) continue
    const { AT } = make({})
    assert.deepEqual(AT('anything'), { agentType: 'anything' }, `${file}: AT() with no missing_agent_types must bind every type`)
  }
})

test("AC-7: maintain-triage.js's NEW() folds into AT() (same drop/keep semantics as AT, whether an alias or gone)", () => {
  const text = readWorkflow('maintain-triage.js')
  const { hasAT, hasNew, make } = loadHelperFactory(text)
  assert.ok(hasAT, 'maintain-triage.js must declare AT()')
  if (hasNew) {
    const { AT, NEW } = make({ missing_agent_types: ['zz-dropped-type'] })
    assert.deepEqual(NEW('zz-dropped-type'), AT('zz-dropped-type'), 'NEW() must honour missing_agent_types the same way AT() does, once folded')
    assert.deepEqual(NEW('zz-kept-type'), AT('zz-kept-type'), 'NEW() must agree with AT() for a kept type')
  }
  // If NEW() no longer exists as a separate declaration, every former NEW(...) call site must now read
  // ...AT(...) instead — covered by AC-1 (every site names an agentType through AT()/NEW()) and AC-13
  // (label/model/schema at each site unchanged).
})

test("AC-7: maintain-triage.js's four previously-NEW-covered types (triage, reproducer, root-cause, patch-drafter) are still droppable via missing_agent_types", () => {
  const text = readWorkflow('maintain-triage.js')
  const { hasAT, make } = loadHelperFactory(text)
  if (!hasAT) return
  for (const type of ['triage', 'reproducer', 'root-cause', 'patch-drafter']) {
    const { AT } = make({ missing_agent_types: [type] })
    assert.deepEqual(AT(type), {}, `maintain-triage.js: AT('${type}') must drop when '${type}' is in missing_agent_types`)
  }
})
