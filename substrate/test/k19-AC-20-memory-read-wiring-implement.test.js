// spec-wi-b1-b2-memory-to-build AC-20. Written from the Spec only.
//
// "the memory-read agent call in build-implement" / "source structure is inspected" / "it runs at most
// once per run, before the per-task pipeline and not once per task, and only when args.memory_ref is
// truthy. It uses MODEL.cheap and a read-only agentType through AT()."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkflowText } from './extract-fixloop.js'
import { REPO } from './fixloop-helpers.js'
import { agentCalls, calleeArgSpans, isGuardedBy } from './k19-agent-call-helpers.js'
import { functionNamed } from './b5-wiring-helpers.js'

function memoryReadCalls(text) {
  return agentCalls(text).filter(c => /result\.roll/.test(c.prompt) || /memory_ref/.test(c.prompt))
}

function agentToolsOf(agentType) {
  const p = path.join(REPO, '.claude', 'agents', `${agentType}.md`)
  if (!fs.existsSync(p)) return null
  const m = fs.readFileSync(p, 'utf8').match(/^tools:\s*(.*)$/m)
  return m ? m[1].split(',').map(s => s.trim()) : []
}

test('AC-20: build-implement.js makes at most one memory-read agent call', () => {
  const text = readWorkflowText()
  const calls = memoryReadCalls(text)
  assert.ok(calls.length <= 1, `expected at most one memory-read agent() call, found ${calls.length}`)
})

test('AC-20: the memory-read agent call, when present, runs before the per-task pipeline and not once per task (outside runTask, and before pipeline(...) starts)', () => {
  const text = readWorkflowText()
  const calls = memoryReadCalls(text)
  if (!calls.length) return // "at most once" — absent entirely is also compliant with AC-20's own wording
  const [call] = calls
  const runTask = functionNamed(text, 'runTask')
  assert.ok(!(call.nameStart > runTask.bodyStart && call.nameStart < runTask.bodyEnd),
    'the memory-read call must not be nested inside runTask (the per-task pipeline body)')
  const pipelineSpans = calleeArgSpans(text, 'pipeline')
  assert.ok(pipelineSpans.length > 0, 'expected build-implement.js to call pipeline(tasks, ...)')
  assert.ok(call.nameStart < pipelineSpans[0].nameStart,
    'the memory-read call must run before the per-task pipeline(...) call')
})

test('AC-20: the memory-read agent call is guarded by args.memory_ref being truthy, uses MODEL.cheap, and a read-only agentType (never "mechanical")', () => {
  const text = readWorkflowText()
  const calls = memoryReadCalls(text)
  if (!calls.length) return
  const [call] = calls
  assert.ok(isGuardedBy(text, call.nameStart, /A\.memory_ref/), 'the call must sit inside an if (...A.memory_ref...) guard')
  assert.equal(call.model, 'MODEL.cheap', `expected MODEL.cheap, got ${call.model}`)
  assert.ok(call.agentType, 'expected the call to bind an agentType through AT(...)')
  assert.notEqual(call.agentType, 'mechanical', 'the memory-read agentType must not be "mechanical"')
  const tools = agentToolsOf(call.agentType)
  assert.ok(tools != null, `expected .claude/agents/${call.agentType}.md to exist`)
  const allowed = new Set(['Read', 'Glob', 'Grep'])
  assert.ok(tools.length > 0 && tools.every(t => allowed.has(t)),
    `expected agentType ${call.agentType}'s tools (${tools.join(', ')}) to be a subset of Read/Glob/Grep`)
})
