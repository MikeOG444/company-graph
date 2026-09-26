// spec-wi-b8-tests-run-the-task-code AC-11. Written from the Spec only.
//
// "The tests: prompt (label tests:${task.id}) in build-implement.js and .claude/agents/test-author.md. Their
// text is read. Both say to never import with a relative path that climbs out of the TestSet directory. Both
// say to import repo test helpers as './helpers.js', './fixloop-helpers.js' and './extract-fixloop.js'. Both
// say a test that starts a local HTTP server in-process must drive the CLI with an async child process, never
// spawnSync."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkflowText } from './extract-fixloop.js'
import { callSites, codeMask } from './b5-wiring-helpers.js'

const REPO = process.cwd()
const TEST_AUTHOR_MD = path.join(REPO, '.claude', 'agents', 'test-author.md')

// Matches the '(' at `open` to its closing ')', skipping characters codeMask marks as non-code
// (inside a string, a template literal's literal text, or a comment), so a ')' that only appears
// inside the prompt text itself can't end the call early.
function matchParen(text, open) {
  if (text[open] !== '(') throw new Error(`matchParen: no ( at ${open}`)
  const mask = codeMask(text)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (!mask[i]) continue
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i + 1 }
  }
  throw new Error(`matchParen: unbalanced ( at ${open}`)
}

// The text of the one agent(...) call labelled `tests:${task.id}`. Found by locating every CALL to
// `agent` via callSites (never a declaration, never a mention inside a comment or string) and keeping
// the call whose own bounded text carries that label — never by searching the whole file for the
// label first and walking outward from it, which would find a declaration or an unrelated mention of
// the label just as easily as the real call.
function testsAgentCallText(text) {
  const sites = callSites(text, 'agent')
  const calls = sites.map(at => {
    const parenAt = text.indexOf('(', at)
    return text.slice(at, matchParen(text, parenAt))
  })
  const matches = calls.filter(call => /`tests:\$\{task\.id\}`/.test(call))
  assert.strictEqual(matches.length, 1,
    `expected exactly one agent() call labelled tests:\${task.id}, found ${matches.length}`)
  return matches[0]
}

test('AC-11: both the tests: prompt in build-implement.js and test-author.md say never to use a relative import that climbs out of the TestSet directory', () => {
  const text = readWorkflowText()
  const testsCall = testsAgentCallText(text)
  const testAuthorMd = fs.readFileSync(TEST_AUTHOR_MD, 'utf8')
  for (const doc of [testsCall, testAuthorMd]) {
    assert.match(doc, /relative\s+(import|path)/i, 'must mention a relative import/path')
    assert.match(doc, /climb|escape|outside|leaves?\s+the\s+TestSet|out\s+of\s+the\s+TestSet/i,
      'must say a relative import must never climb out of / escape the TestSet directory')
  }
})

test('AC-11: both docs say to import repo test helpers as \'./helpers.js\', \'./fixloop-helpers.js\' and \'./extract-fixloop.js\'', () => {
  // The Spec quotes the literal specifiers themselves ('./helpers.js', './fixloop-helpers.js',
  // './extract-fixloop.js') -- it does not mandate which punctuation the prose wraps them in
  // (straight quotes, backticks, etc. are all valid markdown/prompt conventions). So require the
  // literal path text, tolerant of whatever quoting/backtick character surrounds it.
  const text = readWorkflowText()
  const testsCall = testsAgentCallText(text)
  const testAuthorMd = fs.readFileSync(TEST_AUTHOR_MD, 'utf8')
  for (const doc of [testsCall, testAuthorMd]) {
    assert.match(doc, /['"`]\.\/helpers\.js['"`]/, "must name './helpers.js'")
    assert.match(doc, /['"`]\.\/fixloop-helpers\.js['"`]/, "must name './fixloop-helpers.js'")
    assert.match(doc, /['"`]\.\/extract-fixloop\.js['"`]/, "must name './extract-fixloop.js'")
  }
})

test('AC-11: both docs say a test starting a local HTTP server in-process must drive the CLI with an async child process, never spawnSync', () => {
  // The Spec's "then" text is prose describing the required BEHAVIOUR (drive the CLI via an
  // asynchronous child process, not the synchronous spawnSync call) -- it puts no quote marks
  // around "async", "child process" or "spawnSync", so a compliant doc is free to phrase this
  // however it likes as long as it conveys that behaviour. In particular, a natural way to name
  // the mechanism is Node's own module name `child_process` (underscore, one word) rather than
  // the two-word English phrase "child process" -- e.g. "drive it via child_process.spawn, never
  // spawnSync". A regex that only accepts a whitespace separator between "child" and "process"
  // would reject that substantively correct doc, so tolerate underscore/hyphen/space alike, and
  // accept "asynchronous" alongside "async" for the same reason.
  const text = readWorkflowText()
  const testsCall = testsAgentCallText(text)
  const testAuthorMd = fs.readFileSync(TEST_AUTHOR_MD, 'utf8')
  const childProcess = /child[\s_-]*process/i
  const asyncIndication = /\basync\b|asynchronous/i
  for (const doc of [testsCall, testAuthorMd]) {
    assert.match(doc, /HTTP\s+server/i, 'must mention an HTTP server')
    assert.match(doc, childProcess, 'must mention a child process')
    assert.match(doc, asyncIndication, 'must say the child process is asynchronous')
    assert.match(doc, /never\s+spawnSync|not\s+spawnSync|spawnSync[^.]*never/i, 'must say never spawnSync')
  }
})
