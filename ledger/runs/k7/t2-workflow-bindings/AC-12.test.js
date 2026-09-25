// AC-12 (spec-wi-a5-agent-least-privilege): "the repository after the change: npm test is run from the
// repository root (node --test substrate/test/*.test.js) ... the whole suite passes, including the
// pre-existing plan-selection.test.js assertions that build-spec still spawns its judgment agents and
// spawns no 'planner'."
//
// This file does not itself spawn `npm test` / the full `substrate/test/*.test.js` glob: once landed under
// substrate/test/, this very file matches that glob, and a test spawning the glob that contains itself
// recurses without bound. Instead it does two things a full-suite run would also catch for THIS work item's
// surfaces: every workflow file it touches must still be syntactically valid Node, and the one pre-existing
// test file the spec calls out by name (plan-selection.test.js) must independently still pass when run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { REPO, WORKFLOW_FILES, WORKFLOWS_DIR } from './binding-helpers.js'

test('AC-12: every workflow file this task touches is still syntactically valid JavaScript', () => {
  // These files are top-level `return`-ing bodies the runtime evaluates as an async function, not
  // standalone modules/scripts — `node --check` on the raw file rejects the (valid, intentional) top-level
  // return. Parse it the way the runtime does instead: as the body of an async function. This only parses
  // (via the Function constructor), it never executes the body.
  for (const file of WORKFLOW_FILES) {
    const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8')
    // Each file has exactly one `export const meta = {...}` at the top (the runtime's own way of reading
    // workflow metadata) and otherwise reads as a top-level async function body. Drop the `export ` keyword
    // (leaving the `const meta = {...}` assignment intact) so this parses as a function body, the way the
    // runtime itself evaluates the rest of the file.
    const text = raw.replace(/^export const meta = /m, 'const meta = ')
    try {
      // eslint-disable-next-line no-new-func
      new Function(`return (async function () {\n${text}\n})`)
    } catch (err) {
      assert.fail(`${file} must remain syntactically valid after binding its agent() call sites: ${err.message}`)
    }
  }
})

test('AC-12: substrate/test/plan-selection.test.js still passes on its own (build-spec still spawns judgment agents, spawns no planner)', () => {
  const target = path.join(REPO, 'substrate', 'test', 'plan-selection.test.js')
  // node's test runner refuses to actually run a child `node --test` invocation when it detects it is
  // itself already running under one (it sets NODE_TEST_CONTEXT and skips, silently producing empty
  // output) — strip that env var for the child so it runs for real rather than being skipped.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = execFileSync(process.execPath, ['--test', target], { cwd: REPO, encoding: 'utf8', env })
  assert.ok(/# pass \d+/.test(r), 'expected node --test to report at least one passing test')
  assert.ok(!/# fail [1-9]/.test(r), `plan-selection.test.js must have zero failures:\n${r}`)
})
