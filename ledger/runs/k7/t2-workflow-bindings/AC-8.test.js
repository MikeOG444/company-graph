// AC-8 (spec-wi-a5-agent-least-privilege): "a run whose args set agent_types: false ... every site's
// options object omits agentType, preserving the existing blunt hatch for a session that predates the
// definitions."
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllWorkflows, loadHelperFactory } from './binding-helpers.js'

test('AC-8: with agent_types: false, AT() (and NEW() where present) omits agentType for every type, in every workflow', () => {
  for (const { file, text } of readAllWorkflows()) {
    const { hasAT, hasNew, make } = loadHelperFactory(text)
    assert.ok(hasAT, `${file} must declare an AT() helper`)
    const { AT, NEW } = make({ agent_types: false })
    for (const type of ['mechanical', 'implementer', 'zz-any-type']) {
      assert.deepEqual(AT(type), {}, `${file}: AT('${type}') must omit agentType when agent_types is false`)
    }
    if (hasNew) {
      for (const type of ['triage', 'reproducer']) {
        assert.deepEqual(NEW(type), {}, `${file}: NEW('${type}') must also omit agentType when agent_types is false`)
      }
    }
  }
})

test('AC-8: agent_types: false takes priority even when missing_agent_types is also set', () => {
  for (const { file, text } of readAllWorkflows()) {
    const { hasAT, make } = loadHelperFactory(text)
    if (!hasAT) continue
    const { AT } = make({ agent_types: false, missing_agent_types: ['some-type'] })
    assert.deepEqual(AT('some-type'), {})
    assert.deepEqual(AT('unrelated-type'), {}, `${file}: agent_types: false must drop every type, not just the ones also listed as missing`)
  }
})
