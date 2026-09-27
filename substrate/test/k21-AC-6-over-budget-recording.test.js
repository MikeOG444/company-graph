// spec-wi-c15-c12-c14-line-guards AC-6. Written from the Spec only.
//
// "The run output's over_budget array gains an entry { task_id, round, billed_est, budget } ... A log line
// names the task, the round and both figures. The task continues to the next decision instead of escalating.
// over_budget is [] when no task ever crossed 1x."
//
// The run output's over_budget property is a value bound at the output object literal (`over_budget: <ident>`);
// the Spec never quotes the identifier the implementation must use for that binding, only the shape of the
// entries and the empty-start behaviour. So these tests read whatever identifier is actually bound to
// `over_budget:` in the output object and follow IT to its declaration and its .push call, inside runTask —
// rather than requiring the literal text `over_budget = []` / `over_budget.push(`, which is not what the Spec
// quotes and which a correct implementation using a differently-named local variable would fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed, matchBrace } from './b5-wiring-helpers.js'

// Resolve the identifier bound to `over_budget:` in the run output object literal.
function overBudgetIdent(text) {
  const m = text.match(/\bover_budget\s*:\s*([A-Za-z_$][\w$]*)/)
  assert.ok(m, 'expected the run output object to have an `over_budget: <ident>` property')
  return m[1]
}

test('AC-6: the run output initialises an over_budget collection that starts empty', () => {
  const text = readWorkflowText()
  const ident = overBudgetIdent(text)
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=\\s*\\[\\]`)
  assert.match(
    text,
    declRe,
    `expected ${ident} — the value bound to over_budget in the run output — to be declared and initialised to []`,
  )
})

test('AC-6: over_budget entries carry task_id, round, billed_est and budget', () => {
  const text = readWorkflowText()
  const ident = overBudgetIdent(text)
  const runTask = functionNamed(text, 'runTask')
  const pushRe = new RegExp(`\\b${ident}\\.push\\(`, 'g')
  const calls = []
  let m
  while ((m = pushRe.exec(text))) calls.push(m.index + m[0].length - 1)
  const inRunTask = calls.filter(openParen => openParen > runTask.bodyStart && openParen < runTask.bodyEnd)
  assert.equal(inRunTask.length, 1, `expected exactly one ${ident}.push(...) call inside runTask`)
  const openParen = inRunTask[0]
  const braceStart = text.indexOf('{', openParen)
  assert.ok(braceStart >= 0 && braceStart < openParen + 5, `expected ${ident}.push(...) to push an object literal`)
  const braceEnd = matchBrace(text, braceStart)
  const entry = text.slice(braceStart, braceEnd)
  for (const field of ['task_id', 'round', 'billed_est', 'budget']) {
    assert.match(entry, new RegExp(`\\b${field}\\b`), `expected ${field} on the over_budget entry`)
  }
})

test('AC-6: a log line accompanies the over_budget recording, naming the task and round', () => {
  const text = readWorkflowText()
  const ident = overBudgetIdent(text)
  const runTask = functionNamed(text, 'runTask')
  // Locate the SAME call site the second test confirms: the sole `${ident}.push(...)` call inside
  // runTask's body — never the first textual occurrence of `${ident}.push(` anywhere in the file, which
  // could just as easily land on an unrelated push elsewhere in the module.
  const pushRe = new RegExp(`\\b${ident}\\.push\\(`, 'g')
  const calls = []
  let m
  while ((m = pushRe.exec(text))) calls.push(m.index + m[0].length - 1)
  const inRunTask = calls.filter(openParen => openParen > runTask.bodyStart && openParen < runTask.bodyEnd)
  assert.equal(inRunTask.length, 1, `expected exactly one ${ident}.push(...) call inside runTask`)
  const openParen = inRunTask[0]
  const braceStart = text.indexOf('{', openParen)
  const braceEnd = matchBrace(text, braceStart)
  // The statement immediately following the push (same enclosing block, next line) must log.
  const afterPush = text.slice(braceEnd, braceEnd + 300)
  assert.match(afterPush, /^\s*\)\s*\n\s*log\(/, 'expected a log(...) call on the line right after the over_budget recording')
})

test('AC-6: crossing 1x but staying under 2x does not itself return the budget escalation reason (the run continues)', () => {
  const text = readWorkflowText()
  const ident = overBudgetIdent(text)
  const pushIdx = text.search(new RegExp(`\\b${ident}\\.push\\(`))
  assert.ok(pushIdx >= 0)
  // Find the enclosing `if (...) { ... }` block that guards the recording and confirm it does not itself
  // return the 'budget' escalation reason anywhere in its body.
  const braceOpen = text.lastIndexOf('{', pushIdx)
  const braceEnd = matchBrace(text, braceOpen)
  const guardBlock = text.slice(braceOpen, braceEnd)
  assert.doesNotMatch(
    guardBlock,
    /return\s+'budget'/,
    'the over_budget recording path must not itself return the budget escalation reason',
  )
})
