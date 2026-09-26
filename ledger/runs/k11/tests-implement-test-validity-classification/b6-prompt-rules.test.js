// Tests for spec-wi-b6-test-validity-before-blame AC-14 and AC-15: the fixer prompt (build-implement.js's
// `fix:${task.id}:...` agent call and .claude/agents/fixer.md) must name behaviour_changed /
// behaviour_rationale and the refusal rule; the Test Author prompt (build-implement.js's `tests:${task.id}`
// agent call and .claude/agents/test-author.md) must name substrate/test/b5-wiring-helpers.js and its five
// helpers, the calls-not-first-occurrence rule, and the quote-only-literal rule. Written from the spec ONLY.
//
// Lands in substrate/test/ and runs under the repo's `npm test` (node --test "substrate/test/*.test.js").
//
// Repository paths are resolved from process.cwd() alone, NEVER by counting ".." segments from this file's
// own location. build-implement.js's per-round Test Runner runs the suite AT this file's artifact-store path
// while pointed AT the task's own worktree (it changes into the worktree, then invokes the test runner from
// there), so process.cwd() at test-run time is the tree whose fixer.md / test-author.md / build-implement.js
// actually carry this task's change — the file's own on-disk location never is. That mismatch (REPO computed
// by walking up from import.meta.url, landing on whichever repo this file happens to physically sit under —
// the pre-task commit when run from the artifact store) was the reported defect; the FIXER_MD / TEST_AUTHOR_MD
// paths below no longer go through that path at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed, callSites } from './b5-wiring-helpers.js'

const REPO = process.cwd()
const FIXER_MD = path.join(REPO, '.claude', 'agents', 'fixer.md')
const TEST_AUTHOR_MD = path.join(REPO, '.claude', 'agents', 'test-author.md')

function fixerAgentCallText(text) {
  const rt = functionNamed(text, 'runTask')
  const label = text.search(/`fix:\$\{task\.id\}/)
  assert.ok(label > rt.bodyStart && label < rt.bodyEnd, "expected the fix:${task.id} label inside runTask")
  const callStart = text.lastIndexOf('agent(', label)
  const callEnd = text.indexOf('})', label) + 2
  return text.slice(callStart, callEnd)
}

function testAuthorAgentCallText(text) {
  const label = text.search(/`tests:\$\{task\.id\}`/)
  assert.ok(label > 0, "expected the tests:${task.id} label")
  const callStart = text.lastIndexOf('agent(', label)
  const callEnd = text.indexOf('})', label) + 2
  return text.slice(callStart, callEnd)
}

test('AC-14: both the code-fixer prompt in build-implement.js and fixer.md name behaviour_changed / behaviour_rationale and the refusal rule for a rename-only fix on a test-citing finding', () => {
  const text = readWorkflowText()
  const fixerCall = fixerAgentCallText(text)
  const fixerMd = fs.readFileSync(FIXER_MD, 'utf8')

  for (const doc of [fixerCall, fixerMd]) {
    assert.match(doc, /behaviour_changed/, 'must name behaviour_changed')
    assert.match(doc, /behaviour_rationale/, 'must name behaviour_rationale')
    assert.match(doc, /rename|relabel/i, 'must describe a rename/relabel-only fix')
    assert.match(doc, /behaviour_changed:\s*false|behaviour_changed\s*(is\s*)?false/i, 'must state the false case explicitly')
  }
  // The refusal consequence: routed to the Test Author rather than accepted, specifically for a finding
  // citing a test failure.
  for (const doc of [fixerCall, fixerMd]) {
    assert.match(doc, /test\s*(author|-only)/i, 'must say the fix is routed to the Test Author, not accepted')
    assert.match(doc, /refus|reject|not (be )?accepted/i, 'must say such a fix is refused, not accepted')
  }
})

test('AC-15: both the Test Author prompt in build-implement.js and test-author.md name substrate/test/b5-wiring-helpers.js and each of its five helpers, the calls-not-first-occurrence rule, and the quote-only-literal rule', () => {
  const text = readWorkflowText()
  const testAuthorCall = testAuthorAgentCallText(text)
  const testAuthorMd = fs.readFileSync(TEST_AUTHOR_MD, 'utf8')

  for (const doc of [testAuthorCall, testAuthorMd]) {
    assert.match(doc, /substrate\/test\/b5-wiring-helpers\.js/, 'must name substrate/test/b5-wiring-helpers.js by path')
    for (const helper of ['functionNamed', 'enclosingFunction', 'callSites', 'reachersOf', 'firstCallOf']) {
      assert.match(doc, new RegExp(`\\b${helper}\\b`), `must name the helper ${helper}`)
    }
    assert.match(doc, /calls?\b.*\border\b|order\b.*\bcalls?\b/is, 'must state that a wiring test asserts calls and their order')
    assert.match(doc, /first\s+textual\s+occurrence|first\s+occurrence/i, 'must say never the first textual occurrence of a name')
    assert.match(doc, /exact\s+literal|quote/i, 'must state a literal may be required only when the spec quotes it')
    // The spec's own wording is "it may require an exact literal only when the Spec quotes it" — a paraphrase,
    // not a literal the prompts must reproduce verbatim. Check the SUBSTANCE (the literal requirement is
    // conditioned on the Spec itself quoting it) rather than one fixed phrasing, so a prompt that says the same
    // thing in different words is not a false failure.
    assert.match(doc, /only\s+when[\s\S]{0,120}\bspec\b[\s\S]{0,80}\bquot/i,
      'must tie the literal requirement to the Spec quoting it (in some form of "only when the Spec ... quotes")')
  }
})
