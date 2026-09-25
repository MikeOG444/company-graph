// AC-10 (spec-wi-a5-agent-least-privilege): "each new .claude/agents/*.md definition this work item adds
// ... a judgment definition lists tools exactly 'Read, Glob, Grep', names its model as one of
// opus/sonnet/haiku, and its body states the node's role and that it is read-only; the one new
// write-permitted definition (for integrate:resolve) states why it holds Bash, Write and Edit."
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readAllAgentDefs, BASELINE_AGENT_NAMES, VALID_MODELS, JUDGMENT_TOOLS, holdsWriteTool, toolsList,
} from './agent-defs-helpers.js'

function newDefs() {
  return readAllAgentDefs().filter(d => !BASELINE_AGENT_NAMES.includes(d.stem))
}

test('AC-10: every newly-added agent definition names its model as one of opus, sonnet or haiku', () => {
  const added = newDefs()
  assert.ok(added.length > 0, 'expected new agent definitions to check')
  for (const d of added) {
    assert.ok(
      d.fm && VALID_MODELS.has(d.fm.model),
      `${d.file}: frontmatter 'model' must be one of opus/sonnet/haiku, got '${d.fm?.model}'`,
    )
  }
})

test('AC-10: every newly-added read-only (judgment) definition lists tools exactly Read, Glob, Grep', () => {
  const added = newDefs()
  const readOnly = added.filter(d => !holdsWriteTool(toolsList(d.fm)))
  assert.ok(readOnly.length >= 1, 'expected at least one read-only new definition')
  for (const d of readOnly) {
    const tools = [...toolsList(d.fm)].sort()
    assert.deepEqual(
      tools,
      [...JUDGMENT_TOOLS].sort(),
      `${d.file}: judgment definition must list tools exactly Read, Glob, Grep, got [${tools.join(', ')}]`,
    )
  }
})

test('AC-10: every newly-added read-only (judgment) definition\'s body states the node\'s role and that it is read-only', () => {
  const added = newDefs()
  const readOnly = added.filter(d => !holdsWriteTool(toolsList(d.fm)))
  assert.ok(readOnly.length >= 1, 'expected at least one read-only new definition')
  for (const d of readOnly) {
    const bodyLower = d.body.toLowerCase()
    assert.ok(
      /read[\s-]?only/.test(bodyLower),
      `${d.file}: body must state the definition is read-only (e.g. contain the phrase 'read-only')`,
    )
    assert.ok(
      d.body.trim().length > 0,
      `${d.file}: body must state the node's role, found an empty body`,
    )
    const descriptionOrBody = `${d.fm?.description ?? ''}\n${d.body}`.trim()
    assert.ok(
      descriptionOrBody.length > 20,
      `${d.file}: expected the definition to describe the node's role, body/description looked too sparse`,
    )
  }
})

test('AC-10: the one new write-permitted (integrate:resolve) definition states why it holds Bash, Write and Edit', () => {
  const added = newDefs()
  const writeCapable = added.filter(d => holdsWriteTool(toolsList(d.fm)))
  assert.equal(
    writeCapable.length,
    1,
    `expected exactly one new write-permitted definition, found: ${writeCapable.map(d => d.file).join(', ') || 'none'}`,
  )
  const [def] = writeCapable
  const tools = toolsList(def.fm)
  for (const t of ['Bash', 'Write', 'Edit']) {
    assert.ok(tools.includes(t), `${def.file}: expected tools list to include '${t}'`)
  }
  const bodyLower = def.body.toLowerCase()
  const mentionsWriteTools = ['bash', 'write', 'edit'].some(t => bodyLower.includes(t))
  assert.ok(
    mentionsWriteTools,
    `${def.file}: body must state why the definition holds Bash, Write and Edit`,
  )
  const explanationWords = ['because', 'since', 'needs', 'requires', 'so that', 'in order to', 'stays', 'legitimately']
  assert.ok(
    explanationWords.some(w => bodyLower.includes(w)),
    `${def.file}: body must read as a stated reason for holding write-capable tools, not just a list of tool names`,
  )
})
