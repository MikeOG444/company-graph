// Tests for spec-wi-b5-sibling-value-repair AC-22: this TestSet's own tests resolve repository
// paths only through process.cwd() or the existing sentinel extractors/doc-path helpers, never
// by counting ".." from a test file's own location, and none of them shells out to `npm test` or
// runs a workflow live.
//
// Written from the spec (ledger/runs/k8/spec-wi-b5-sibling-value-repair.json) ONLY. This file
// inspects the sibling b5-*.test.js files' own source text -- a property of THIS TestSet, not of
// any implementation -- which is exactly what AC-22 asks a landed test to guarantee about itself.
//
// Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js"). This file resolves its own directory via
// process.cwd() relative to the known landing location (substrate/test/), per AC-22 itself,
// rather than via import.meta.url path-counting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// This TestSet lands at substrate/test/ and the suite always runs from the repository root
// (per the harness note and package.json's `node --test substrate/test/*.test.js`), so
// process.cwd() is the repository root at test time.
const TEST_DIR = path.join(process.cwd(), 'substrate', 'test')

const B5_PREFIX = 'b5-'

function b5TestFiles() {
  if (!fs.existsSync(TEST_DIR)) return []
  return fs.readdirSync(TEST_DIR)
    .filter(name => name.startsWith(B5_PREFIX) && name.endsWith('.test.js'))
    .map(name => path.join(TEST_DIR, name))
}

test('AC-22: every b5-*.test.js file in substrate/test/ resolves repository paths only via process.cwd() or an imported existing helper, never by counting ".." from its own file location', () => {
  const files = b5TestFiles()
  assert.ok(files.length > 0, 'expected at least one landed b5-*.test.js file to inspect (this file lands alongside its siblings)')

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    // Forbid a test file computing its OWN repo root by counting ancestor directories off its
    // own import.meta.url -- the exact disk-location trap AC-22 rules out. (Importing REPO/paths
    // FROM an existing helper module, e.g. `import { REPO } from './fixloop-helpers.js'`, is fine:
    // that module resolves relative to ITS OWN committed location, not this file's.)
    assert.doesNotMatch(text, /fileURLToPath\(import\.meta\.url\)/,
      `${path.basename(file)} must not derive a path from its own file location; use process.cwd() or an existing helper's export instead`)
    assert.doesNotMatch(text, /path\.resolve\([^)]*'\.\.'[^)]*'\.\.'/,
      `${path.basename(file)} must not count ".." twice from its own location to find the repo root`)
  }
})

test('AC-22: no b5-*.test.js file shells out to npm test or executes a workflow file live', () => {
  const files = b5TestFiles()
  assert.ok(files.length > 0)

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    // Forbid actually INVOKING "npm test" (e.g. inside an exec call or a template literal handed
    // to a shell runner), not merely mentioning the phrase in a comment describing how the repo's
    // own test runner is invoked -- every TestSet in this repo carries that comment verbatim.
    assert.doesNotMatch(text, /(exec\w*|spawn\w*)\([^)]*npm\s+test/i,
      `${path.basename(file)} must not shell out to "npm test"`)
    // Forbid actually IMPORTING or CALLING node's child_process facilities -- not merely naming
    // them inside a string/regex literal that is itself testing some OTHER file's source for the
    // same forbidden tokens (b5-boundary-repair-functions.test.js and b5-criterion-coupling.test.js
    // both legitimately quote these identifiers for exactly that purpose, per AC-1/AC-2's own
    // "must not shell out" requirement on the IMPLEMENTATION's new functions).
    assert.doesNotMatch(text, /from\s+['"]node:child_process['"]|require\(['"]\w*child_process['"]\)/,
      `${path.basename(file)} must not import child_process`)
    assert.doesNotMatch(text, /\b(child_process|execSync|spawnSync)\s*\.\s*\w+\(|^\s*(execSync|spawnSync|spawn|exec)\(/m,
      `${path.basename(file)} must not shell out at all`)
    // A workflow is read as TEXT (readWorkflowText()) throughout this TestSet; none of these
    // files may import a workflow module as executable ESM, which would run it live.
    assert.doesNotMatch(text, /import\([^)]*\.claude\/workflows/, `${path.basename(file)} must not dynamically import a workflow module`)
    assert.doesNotMatch(text, /from\s+['"][^'"]*\.claude\/workflows[^'"]*\.js['"]/,
      `${path.basename(file)} must not statically import a workflow module as executable code`)
  }
})
