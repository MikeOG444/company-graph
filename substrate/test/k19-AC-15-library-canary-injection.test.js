// spec-wi-b1-b2-memory-to-build AC-15. Written from the Spec only.
//
// "build-implement invoked with args.memory_ref and no args.canary, and selectCanary returns a canary for
// a task" / "the task reaches the canary step" / "the library canary's mutation goes through the same
// existing canary mutation agent call (same label pattern canary:<task.id>, same prompt wording and
// ChangeSet schema, with only the mutation text taken from the library). The task records canary_source
// 'library' and the canary id."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { agentCallsByLabelRegex, ifBlocksMatching } from './k19-agent-call-helpers.js'

test('AC-15: there remains exactly one canary-mutation agent call, labelled canary:<task.id>, using the ChangeSet schema, MODEL.cheap and the mechanical agentType (unchanged)', () => {
  const text = readWorkflowText()
  const calls = agentCallsByLabelRegex(text, /^`canary:\$\{task\.id\}`$/)
  assert.equal(calls.length, 1, `expected exactly one canary:\${task.id} agent() call, found ${calls.length}`)
  const [call] = calls
  assert.equal(call.schema, 'ChangeSet')
  assert.equal(call.model, 'MODEL.cheap')
  assert.equal(call.agentType, 'mechanical')
})

test('AC-15: the single canary-mutation call site is shared by both the args.canary path and the library path (it sits outside the args.canary-match branch, not duplicated inside it)', () => {
  const text = readWorkflowText()
  const calls = agentCallsByLabelRegex(text, /^`canary:\$\{task\.id\}`$/)
  assert.equal(calls.length, 1)
  const [call] = calls
  const hits = ifBlocksMatching(text, /A\.canary/)
  const argsBranch = hits.find(h => /task_id/.test(h.condText) && /spec_id/.test(h.condText))
  assert.ok(argsBranch, 'expected the args.canary-match branch to still exist')
  assert.ok(!(call.nameStart > argsBranch.ifBlock.start && call.nameStart < argsBranch.ifBlock.end),
    'the shared canary-mutation call must sit outside the args.canary-only branch so a library-selected canary reaches it too')
})
