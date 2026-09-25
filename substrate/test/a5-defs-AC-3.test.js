// AC-3 (spec-wi-a5-agent-least-privilege, scoped to task t1-agent-definitions): "the test checks whether
// [a definition's tools] list contains Bash, Write or Edit ... the site passes only if it appears in an
// explicit WRITE_PERMITTED allowlist ... any other site holding a write-capable type fails."
//
// t1's own task description narrows this to the definitions it adds: "Add the read-only agent definitions
// the bindings name, plus the one write-permitted definition for integrate:resolve." So among the
// definitions this task newly commits (i.e. every .md file not already present before this task landed),
// exactly one may hold a write-capable tool (Bash, Write or Edit) — the integrate:resolve definition — and
// every other new definition must hold no write-capable tool at all.
//
// This test does not read or infer from any implementation; BASELINE_AGENT_NAMES in the helper is a
// fixture of the repo's pre-task state (the set of .claude/agents/*.md files that existed before this
// spec's work item), not a guess about what the implementer will write.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllAgentDefs, BASELINE_AGENT_NAMES, holdsWriteTool, toolsList } from './a5-agent-defs-helpers.js'

function newDefs() {
  return readAllAgentDefs().filter(d => !BASELINE_AGENT_NAMES.includes(d.stem))
}

test('AC-3: task t1 adds at least one new agent definition beyond the pre-existing baseline', () => {
  const added = newDefs()
  assert.ok(
    added.length > 0,
    'expected new .md files under .claude/agents/ for the judgment and integrate:resolve bindings the spec describes',
  )
})

test('AC-3: exactly one newly-added agent definition holds a write-capable tool (Bash, Write or Edit)', () => {
  const added = newDefs()
  const writeCapable = added.filter(d => holdsWriteTool(toolsList(d.fm)))
  assert.equal(
    writeCapable.length,
    1,
    `expected exactly one write-permitted new definition (integrate:resolve), found: ${writeCapable.map(d => d.file).join(', ') || 'none'}`,
  )
})

test('AC-3: the one write-permitted new definition is named for integrate:resolve and holds Bash, Write and Edit', () => {
  const added = newDefs()
  const writeCapable = added.filter(d => holdsWriteTool(toolsList(d.fm)))
  assert.equal(writeCapable.length, 1, 'precondition: exactly one write-permitted new definition')
  const [def] = writeCapable
  const stemNormalized = def.stem.toLowerCase().replace(/[^a-z]/g, '')
  assert.ok(
    stemNormalized.includes('integrate') && stemNormalized.includes('resolve'),
    `expected the write-permitted definition's filename to identify it as the integrate:resolve site, got '${def.file}'`,
  )
  const tools = toolsList(def.fm)
  for (const t of ['Bash', 'Write', 'Edit']) {
    assert.ok(tools.includes(t), `${def.file}: expected tools list to include '${t}', got [${tools.join(', ')}]`)
  }
})

test('AC-3: every other newly-added agent definition lists exactly Read, Glob, Grep and no write-capable tool', () => {
  const added = newDefs()
  const readOnly = added.filter(d => !holdsWriteTool(toolsList(d.fm)))
  assert.ok(readOnly.length >= 1, 'expected at least one read-only new definition')
  for (const d of readOnly) {
    const tools = toolsList(d.fm)
    assert.deepEqual(
      [...tools].sort(),
      ['Glob', 'Grep', 'Read'],
      `${d.file}: a judgment definition must list tools exactly Read, Glob, Grep, got [${tools.join(', ')}]`,
    )
  }
})
