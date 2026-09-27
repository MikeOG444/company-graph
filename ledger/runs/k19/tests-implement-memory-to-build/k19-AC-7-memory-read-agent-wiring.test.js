// spec-wi-b1-b2-memory-to-build AC-7. Written from the Spec only.
//
// "build-spec invoked with args.memory_ref" / "the workflow runs" / "exactly one memory-read agent call
// runs, once per run and not once per work item. It uses MODEL.cheap, a read-only agentType bound through
// AT() (for example 'memory-analyst', or another type whose tools are only Read/Glob/Grep, never
// 'mechanical'), and a JSON schema returning { patterns: [...], canaries: [...] }. Its prompt tells it to
// read the file at memory_ref, take result.roll or else result, return patterns and canaries verbatim,
// never judge or filter, and write or change nothing."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkflowText } from './k19-patterns-extract-helpers.js'
import { REPO } from './fixloop-helpers.js'
import { agentCalls, calleeArgSpans, isWithinAnySpan, isGuardedBy } from './k19-agent-call-helpers.js'

// A "memory-read" call: an agent() call whose prompt mentions reading result.roll (the MemoryRoll shape,
// per the spec's own "take result.roll or else result") — the one structural fingerprint the spec itself
// gives this call, rather than assuming any particular label text (which the spec never quotes).
function memoryReadCalls(text) {
  return agentCalls(text).filter(c => /result\.roll/.test(c.prompt) || /memory_ref/.test(c.prompt))
}

function agentToolsOf(agentType) {
  const p = path.join(REPO, '.claude', 'agents', `${agentType}.md`)
  if (!fs.existsSync(p)) return null
  const m = fs.readFileSync(p, 'utf8').match(/^tools:\s*(.*)$/m)
  return m ? m[1].split(',').map(s => s.trim()) : []
}

test('AC-7: build-spec.js makes exactly one memory-read agent call', () => {
  const text = readWorkflowText()
  const calls = memoryReadCalls(text)
  assert.equal(calls.length, 1, `expected exactly one memory-read agent() call, found ${calls.length}`)
})

test('AC-7: the memory-read agent call runs once per run, not once per work item (outside the per-work-item pipeline callback)', () => {
  const text = readWorkflowText()
  const [call] = memoryReadCalls(text)
  assert.ok(call, 'expected a memory-read agent() call')
  const pipelineSpans = calleeArgSpans(text, 'pipeline')
  assert.ok(pipelineSpans.length > 0, 'expected build-spec.js to call pipeline(...) over work items')
  assert.ok(!isWithinAnySpan(call.nameStart, pipelineSpans),
    'the memory-read agent call must not be nested inside the per-work-item pipeline(...) callback')
})

test('AC-7: the memory-read agent call is guarded by args.memory_ref being truthy', () => {
  const text = readWorkflowText()
  const [call] = memoryReadCalls(text)
  assert.ok(call)
  assert.ok(isGuardedBy(text, call.nameStart, /A\.memory_ref/), 'the call must sit inside an if (...A.memory_ref...) guard')
})

test('AC-7: the memory-read agent call uses MODEL.cheap and a read-only agentType (never "mechanical")', () => {
  const text = readWorkflowText()
  const [call] = memoryReadCalls(text)
  assert.ok(call)
  assert.equal(call.model, 'MODEL.cheap', `expected MODEL.cheap, got ${call.model}`)
  assert.ok(call.agentType, 'expected the call to bind an agentType through AT(...)')
  assert.notEqual(call.agentType, 'mechanical', 'the memory-read agentType must not be "mechanical" (that type is not read-only)')
  const tools = agentToolsOf(call.agentType)
  assert.ok(tools != null, `expected .claude/agents/${call.agentType}.md to exist`)
  const allowed = new Set(['Read', 'Glob', 'Grep'])
  assert.ok(tools.length > 0 && tools.every(t => allowed.has(t)),
    `expected agentType ${call.agentType}'s tools (${tools.join(', ')}) to be a subset of Read/Glob/Grep`)
})

test('AC-7: the memory-read prompt tells the agent to read memory_ref, take result.roll or else result, return patterns and canaries verbatim, never judge or filter, and write/change nothing', () => {
  const text = readWorkflowText()
  const [call] = memoryReadCalls(text)
  assert.ok(call)
  assert.match(call.prompt, /result\.roll/, 'prompt must mention result.roll')
  assert.match(call.prompt, /patterns/i)
  assert.match(call.prompt, /canaries/i)
  assert.match(call.prompt, /verbatim/i, 'prompt must tell the agent to return the data verbatim, unjudged')
  assert.match(call.prompt, /never (judge|filter)|not (judge|filter)|without judg(e|ing)/i,
    'prompt must instruct the agent never to judge or filter')
  assert.match(call.prompt, /(write|change) nothing|never write|read-?only|read only/i,
    'prompt must instruct the agent to write or change nothing')
})
