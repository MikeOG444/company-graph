// Tests for spec-wi-b5-sibling-value-repair AC-15: the implementer agent() prompt in
// build-implement.js and .claude/agents/implementer.md both interpolate/state the sibling
// tasks' ids and owned_surfaces, both say never to write inside a sibling's owned surfaces, and
// both say a task that needs a sibling-created value should return needs_from_sibling instead
// of inventing it.
//
// Written from the spec (ledger/runs/k8/spec-wi-b5-sibling-value-repair.json) ONLY.
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). implementer.md's path is resolved only through
// IMPLEMENTER_MD_PATH as already exported by substrate/test/t2-doc-paths.js, never by counting
// ".." from this file's own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { IMPLEMENTER_MD_PATH } from './t2-doc-paths.js'
import { readWorkflowText } from './extract-fixloop.js'

test('AC-15: the implementer agent() prompt in build-implement.js interpolates the sibling tasks\' ids and owned_surfaces', () => {
  const text = readWorkflowText()
  // The implementer's own prompt already interpolates `siblings` in some form for the boundary
  // work (spec-wi-owned-surfaces-boundary); this spec requires it still names each sibling's id
  // and owned_surfaces, not just a bare list.
  assert.match(text, /siblings/, 'expected the implementer prompt to reference the sibling tasks')
  assert.match(text, /owned_surfaces/, 'expected the implementer prompt to reference owned_surfaces')
})

test('AC-15: the implementer agent() prompt tells the implementer never to write inside a sibling\'s owned surfaces, and to return needs_from_sibling instead of inventing a sibling-owned value', () => {
  const text = readWorkflowText()
  assert.match(text, /never\s+write|do not write|must not write/i, 'expected the prompt to forbid writing inside a sibling\'s owned surfaces')
  assert.match(text, /needs_from_sibling/, 'expected the prompt to name needs_from_sibling as the alternative to inventing a value')
  assert.match(text, /invent/i, 'expected the prompt to contrast needs_from_sibling with inventing the value')
})

test('AC-15: implementer.md tells the implementer never to write inside a sibling\'s owned surfaces', () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')
  assert.match(text, /sibling/i, 'expected implementer.md to reference a sibling task\'s owned surfaces')
  assert.match(text, /never\s+write|do not write|must not write/i, 'expected implementer.md to forbid writing inside a sibling\'s owned surfaces')
})

test('AC-15: implementer.md says that when the task needs a value a sibling creates, the implementer returns needs_from_sibling instead of inventing the value', () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')
  assert.match(text, /needs_from_sibling/, 'expected implementer.md to document the needs_from_sibling field')
  assert.match(text, /invent/i, 'expected implementer.md to say needs_from_sibling replaces inventing the value')
  assert.match(text, /sibling.*creates|value.*sibling|needs a value/i, 'expected implementer.md to describe the case: a value a sibling creates')
})

test('AC-15: implementer.md still satisfies every AC-17-implementer-boundary-doc.test.js assertion (touched_surfaces honesty, code-checked boundary, sibling ends-the-task wording, and its pre-existing rules)', () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')

  // touched_surfaces reported completely and honestly from the diff.
  assert.match(text, /touched_surfaces/)
  assert.match(text, /complete(ly)?/i)
  assert.match(text, /honest(ly)?/i)
  assert.match(text, /diff/i)

  // the owned-surfaces boundary is checked in code after the ChangeSet is returned.
  assert.match(text, /owned[- ]surfaces?/i)
  assert.match(text, /checked in code|enforced in code|code[- ]checked|checked (by|in) the (workflow|script|code)/i)
  assert.match(text, /ChangeSet/)
  assert.match(text, /(is|are)\s+returned|after.*returned|returned.*after/i)

  // writing a sibling's owned surface ends the task rather than helping it.
  assert.match(text, /ends? the task/i)
  assert.match(text, /help(s|ing)?/i)

  // pre-existing rules survive.
  assert.match(text, /worktree/i)
  assert.match(text, /criteria_ids/)
  assert.match(text, /\bref\b/i)
  assert.match(text, /notes/i)
  assert.match(text, /hidden|verifiers|not (visible|shown)/i)
  assert.match(text, /no tests|not write tests|must not write tests|never writes? tests/i)
})
