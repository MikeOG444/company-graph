// spec-wi-b8-tests-run-the-task-code AC-7. Written from the Spec only.
//
// "The TestResults schema in build-implement.js and the Test Runner agent call labelled run:${task.id}:${tag}
// inside runTask. The schema object and the runner prompt are inspected. TestResults has an imports property:
// an array of objects with string properties file and specifier. The runner prompt tells the agent to report
// every relative import/require specifier in every file under the TestSet it ran, and to report without
// judging."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { functionNamed } from './b5-wiring-helpers.js'

test('AC-7: the inline TestResults const declares an imports property: array of { file, specifier } strings', () => {
  const text = readWorkflowText()
  const start = text.indexOf('const TestResults = {')
  assert.ok(start >= 0, 'expected the inline TestResults const')
  const end = text.indexOf('\nconst ', start + 1)
  const block = text.slice(start, end > start ? end : start + 2000)
  const importsMatch = block.match(/imports\s*:\s*\{[^}]*type\s*:\s*'array'[^}]*\}/s)
  assert.ok(importsMatch, "expected TestResults.imports typed as an array, found: " + block)
  // items must require file and specifier as strings — search a generous window after the imports: key for its
  // items object (which may itself contain nested braces), rather than relying on the coarse importsMatch above.
  const importsKeyIdx = block.indexOf('imports')
  const itemsWindow = block.slice(importsKeyIdx, importsKeyIdx + 400)
  assert.match(itemsWindow, /file\s*:\s*\{\s*type\s*:\s*'string'/, 'imports items must declare file: { type: "string" }')
  assert.match(itemsWindow, /specifier\s*:\s*\{\s*type\s*:\s*'string'/, 'imports items must declare specifier: { type: "string" }')
})

test('AC-7: the Test Runner agent call (label run:${task.id}:${tag}) tells the agent to report every relative import/require specifier in every TestSet file, without judging', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const labelIdx = text.indexOf('`run:${task.id}:${tag}`', rt.bodyStart)
  assert.ok(labelIdx > rt.bodyStart && labelIdx < rt.bodyEnd, 'expected the run:${task.id}:${tag} label inside runTask')
  const callStart = text.lastIndexOf('agent(', labelIdx)
  assert.ok(callStart > rt.bodyStart, 'expected an agent( call owning the run: label')
  const prompt = text.slice(callStart, labelIdx)
  assert.match(prompt, /relative\s+import|import\s*\/\s*require|import.*require.*specifier/is,
    'the runner prompt must ask for relative import/require specifiers')
  assert.match(prompt, /every\s+file|each\s+file|all\s+files/i, 'the runner prompt must ask about every file under the TestSet, not just one')
  assert.match(prompt, /without\s+judg|report[^.]*\bfacts?\b|never\s+judge|no\s+judg/i,
    'the runner prompt must ask the agent to report without judging')
})
