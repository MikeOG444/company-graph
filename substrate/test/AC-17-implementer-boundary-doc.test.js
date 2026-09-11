// AC-17: .claude/agents/implementer.md must state that touched_surfaces must be
// reported completely and honestly from the diff, that the owned-surfaces boundary is
// now CHECKED IN CODE after the ChangeSet is returned, and that writing a sibling
// task's owned surface ends the task rather than helping it — while keeping its
// existing rules (worktree only, criteria_ids only, diff by ref, notes hidden from
// verifiers, no tests).
//
// Written from spec-wi-owned-surfaces-boundary (.artifacts/build/t7/specs/spec-wi-owned-
// surfaces-boundary.json) only. Lands in substrate/test/ and runs under the repo's
// `npm test` (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { IMPLEMENTER_MD_PATH } from './t2-doc-paths.js'

test('AC-17: implementer.md states touched_surfaces must be reported completely and honestly from the diff', () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')

  assert.match(text, /touched_surfaces/, 'must reference touched_surfaces')
  assert.match(text, /complete(ly)?/i, 'must require touched_surfaces be reported completely')
  assert.match(text, /honest(ly)?/i, 'must require touched_surfaces be reported honestly')
  assert.match(text, /diff/i, 'must tie touched_surfaces to the diff')
})

test('AC-17: implementer.md states the owned-surfaces boundary is now checked in code after the ChangeSet is returned', () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')

  assert.match(text, /owned[- ]surfaces?/i, 'must reference the owned-surfaces boundary')
  assert.match(text, /checked in code|enforced in code|code[- ]checked|checked (by|in) the (workflow|script|code)/i, 'must state the boundary is checked in code')
  assert.match(text, /ChangeSet/, 'must reference the ChangeSet')
  assert.match(text, /(is|are)\s+returned|after.*returned|returned.*after/i, 'must state the check happens after the ChangeSet is returned')
})

test("AC-17: implementer.md states writing a sibling task's owned surface ends the task rather than helping it", () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')

  assert.match(text, /sibling/i, "must reference a sibling task's owned surface")
  assert.match(text, /ends? the task/i, 'must state that straying ends the task')
  assert.match(text, /help(s|ing)?/i, 'must contrast ending the task with "helping" it')
})

test('AC-17: implementer.md keeps its existing rules (worktree only, criteria_ids only, diff by ref, notes hidden from verifiers, no tests)', () => {
  const text = fs.readFileSync(IMPLEMENTER_MD_PATH, 'utf8')

  assert.match(text, /worktree/i, 'the worktree-only rule must still be present')
  assert.match(text, /criteria_ids/, 'the criteria_ids-only rule must still be present')
  assert.match(text, /\bref\b/i, 'the diff-by-ref rule must still be present')
  assert.match(text, /diff/i, 'the diff rule must still be present')
  assert.match(text, /notes/i, 'the notes field must still be documented')
  assert.match(text, /hidden|verifiers|not (visible|shown)/i, 'notes must still be documented as hidden from verifiers')
  assert.match(text, /no tests|not write tests|must not write tests|never writes? tests/i, 'the no-tests rule must still be present')
})
