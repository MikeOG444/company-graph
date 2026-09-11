// Regression tests for the three defects run t7i exposed in the build line itself. Each pins the CONTRACT the
// fix establishes, not the wording of the fix:
//
//   1. The lens prompt never named the worktree. Every other verify-loop prompt did; the lens builder passed
//      only the spec text and the inlined diff, so a lens that opened a file greped the repo root at the
//      pre-task commit and re-reported the pre-task file as a defect. t1 escalated repeat_finding on nine
//      findings that were all true of the base commit and all false of the change under review.
//   2. The TestSet lander copied only *.test.js, so a helper module a landed test imports never landed and the
//      test failed at import (t2-doc-paths.js: integration came back 62/63 red).
//   3. The strong-model integration resolution was gated on passing.length > 1, so a red suite with a single
//      passing task was accepted silently. A conflict needs two branches; a failure does not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'

const lensPrompt = (text) => {
  const start = text.indexOf('const lens = (name, focus')
  assert.ok(start >= 0, 'expected the shared lens prompt builder')
  const end = text.indexOf('const sealVerdict', start)
  assert.ok(end > start)
  return text.slice(start, end)
}

test('t7i-1: the shared lens prompt names the worktree the change is in, as every other verify-loop prompt does', () => {
  const prompt = lensPrompt(readWorkflowText())
  assert.match(prompt, /\$\{wt\}/, 'the lens prompt must interpolate the worktree path')
  assert.match(prompt, /\$\{branch\}/, 'the lens prompt must name the branch the change is committed on')
})

test('t7i-1: the lens prompt says its own cwd is the pre-change tree, so a finding read from there is false', () => {
  const prompt = lensPrompt(readWorkflowText())
  assert.match(prompt, /pre-task|before this change|PRE-TASK/i,
    'the prompt must say the working directory is the state BEFORE the change')
  assert.match(prompt, /false|does NOT contain|not contain/i,
    'the prompt must say a finding built on a file read outside the worktree is false')
})

test('t7i-2: the TestSet lander copies helper modules, not only *.test.js', () => {
  const text = readWorkflowText()
  const start = text.indexOf('BEFORE running the suite, land the tests')
  assert.ok(start >= 0, 'expected the TestSet landing instructions')
  const landing = text.slice(start, start + 2000)
  assert.doesNotMatch(landing, /copy every \*\.test\.js/,
    'the lander must not restrict the copy to *.test.js — a helper left behind breaks the import')
  assert.match(landing, /helper/i, 'the lander must say helper modules land too')
  assert.match(landing, /NEVER overwrite/,
    'the never-overwrite rule must survive: it is what protects the repo\'s own helpers once the glob widens')
})

test('t7i-2: the lander accounts for every file it found, and the script reconciles that against what it landed', () => {
  const text = readWorkflowText()
  assert.match(text, /tests_found/, 'the Suite schema and the landing prompt must carry tests_found')
  // The reconciliation is script code, not an agent's judgement: what was found minus what was landed or skipped.
  const reconcileIdx = text.indexOf('const unaccounted =')
  assert.ok(reconcileIdx >= 0, 'the script must compute the unaccounted TestSet files itself')
  const reconcile = text.slice(reconcileIdx, reconcileIdx + 200)
  assert.match(reconcile, /tests_found/, 'the reconciliation must start from tests_found')
  assert.match(text.slice(reconcileIdx - 400, reconcileIdx), /tests_landed[\s\S]*tests_skipped/,
    'the accounted set must be tests_landed together with tests_skipped')
})

test('t7i-3: a failing integration suite triggers the strong-model resolution even with a single passing task', () => {
  const text = readWorkflowText()
  const guardIdx = text.indexOf('let finalSuite = suite')
  assert.ok(guardIdx >= 0, 'expected the integration resolution guard')
  const condIdx = text.indexOf('if (suite &&', guardIdx)
  assert.ok(condIdx > guardIdx, 'expected the resolution condition')
  const cond = text.slice(condIdx, text.indexOf('{', condIdx))

  assert.match(cond, /failed\s*>\s*0/, 'a failing suite must trigger resolution')
  // The >1 task guard may only qualify the conflicts term: a conflict needs two branches, a failure does not.
  const failedIdx = cond.indexOf('failed')
  const lengthIdx = cond.indexOf('passing.length')
  if (lengthIdx >= 0) {
    const conflictsIdx = cond.indexOf('conflicts')
    assert.ok(conflictsIdx >= 0 && Math.abs(lengthIdx - conflictsIdx) < 60,
      'passing.length > 1 must qualify the conflicts term, not the whole condition')
    assert.ok(failedIdx < conflictsIdx || lengthIdx > failedIdx,
      'the failing-suite term must stand on its own, ungated by passing.length')
  }
  assert.match(cond, /unaccounted/, 'an unaccounted TestSet file must also trigger resolution')
})
