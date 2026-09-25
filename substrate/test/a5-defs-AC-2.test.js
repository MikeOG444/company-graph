// AC-2 (spec-wi-a5-agent-least-privilege, scoped to task t1-agent-definitions, owner of .claude/agents/):
// "every referenced name has a committed <name>.md whose frontmatter 'name' field equals its filename
// stem, and an unresolvable name fails the test naming the missing file."
//
// t1 owns only .claude/agents/, not the workflow call sites that reference agentType names, so this test
// covers the half of AC-2 that lives inside t1's surface: every committed definition must be resolvable —
// present, parseable, and self-consistently named — so that a workflow site naming it by filename stem
// actually resolves. The other half (that every workflow-referenced name has such a file) is judged by the
// binding test the spec places out of scope for the Test Author (out_of_scope: "Writing or editing any
// file under substrate/test/. The Test Author owns the new binding test... from AC-2, AC-3, AC-4 and
// AC-11", i.e. a different, dedicated test-author task, not this one).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllAgentDefs, AGENTS_DIR } from './a5-agent-defs-helpers.js'

test('AC-2: at least one committed agent definition exists under .claude/agents/', () => {
  const defs = readAllAgentDefs()
  assert.ok(defs.length > 0, `expected at least one .md file under ${AGENTS_DIR}`)
})

test('AC-2: every committed agent definition parses frontmatter with a name field', () => {
  const defs = readAllAgentDefs()
  for (const d of defs) {
    assert.ok(d.fm, `${d.file}: could not parse a --- frontmatter block`)
    assert.ok(
      typeof d.fm.name === 'string' && d.fm.name.length > 0,
      `${d.file}: frontmatter is missing a non-empty 'name' field`,
    )
  }
})

test('AC-2: every committed agent definition\'s frontmatter name equals its filename stem', () => {
  const defs = readAllAgentDefs()
  const mismatches = defs.filter(d => d.fm?.name !== d.stem)
  assert.deepEqual(
    mismatches.map(d => `${d.file}: name='${d.fm?.name}' stem='${d.stem}'`),
    [],
    'a workflow site naming an agentType by filename stem only resolves to a definition whose frontmatter name field matches',
  )
})
