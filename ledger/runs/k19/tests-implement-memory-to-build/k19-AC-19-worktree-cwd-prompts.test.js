// spec-wi-b1-b2-memory-to-build AC-19. Written from the Spec only.
//
// "build-implement.js source" / "the Test Runner prompt (the run:<task.id>:<tag> agent) and each
// fix-loop repair agent prompt that runs tests (the testfix, fix and impl repair agents) are inspected"
// / "each states that it runs from the task worktree as the current directory and must never copy or
// write files into the main checkout."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { agentCallsByLabelRegex } from './k19-agent-call-helpers.js'

function mentionsWorktreeCwd(prompt) {
  return /worktree/i.test(prompt) && /current directory|\bcwd\b/i.test(prompt)
}

function mentionsNoMainCheckout(prompt) {
  return /main checkout/i.test(prompt) && /never|must not|do not|don'?t/i.test(prompt)
}

const TARGETS = [
  { name: 'Test Runner (run:<task.id>:<tag>)', regex: /^`run:\$\{task\.id\}:\$\{tag\}`$/ },
  { name: 'Test Author repair (testfix:...)', regex: /^`testfix:/ },
  { name: 'Fixer repair (fix:<task.id>:<finding>)', regex: /^`fix:\$\{task\.id\}:\$\{f\.id\}`$/ },
  { name: 'Implementer repair (impl:<task.id>:repair)', regex: /^`impl:\$\{task\.id\}:repair`$/ },
]

for (const { name, regex } of TARGETS) {
  test(`AC-19: every ${name} prompt states it runs from the task worktree as the current directory, and must never copy or write into the main checkout`, () => {
    const text = readWorkflowText()
    const calls = agentCallsByLabelRegex(text, regex)
    assert.ok(calls.length > 0, `expected at least one agent() call matching ${regex}`)
    for (const call of calls) {
      assert.ok(mentionsWorktreeCwd(call.prompt),
        `${name} prompt must state it runs from the task worktree as the current directory: ${call.prompt.slice(0, 200)}...`)
      assert.ok(mentionsNoMainCheckout(call.prompt),
        `${name} prompt must state it must never copy or write into the main checkout: ${call.prompt.slice(0, 200)}...`)
    }
  })
}
