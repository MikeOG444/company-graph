// Guard for spec-wi-c8-node20-test-glob: two invariants that, together, keep `npm test`
// working on Node 20 in both packages.
//
//   1. The support floor never drifts apart: the major version in package.json's
//      engines.node range must always equal the node-version pinned for
//      actions/setup-node in .github/workflows/ci.yml.
//   2. Neither package.json's nor toy/package.json's "test" script re-quotes its
//      `--test` glob argument (quoting it defers glob expansion to a shell that may not
//      exist, which is exactly how this class of defect became invisible on Node 22
//      before this work item), and each script still passes a glob ending in
//      `*.test.js` rather than a bare directory.
//
// This is additive to, and does not amend or duplicate, AC-4 of spec-wi-c4-ci in
// substrate/test/ci-workflow.test.js (which asserts node-version 20 against
// engines.node ">=20" for the real files). Both checks here are pure functions of
// supplied strings, so they can be exercised against synthetic and historical
// (pre-fix) content as well as the real files, per AC-6.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Pure function: extracts the numeric major version pinned to actions/setup-node's
// node-version in a GitHub Actions workflow, read as plain text (no YAML parser).
function workflowNodeVersion(workflowText) {
  const lines = workflowText.split('\n')
  const idx = lines.findIndex((l) => /uses:\s*actions\/setup-node@v[0-9]+/.test(l))
  if (idx === -1) return null
  const window = lines.slice(idx, idx + 8).join('\n')
  const m = window.match(/node-version:\s*['"]?([0-9]+)['"]?\s*$/m)
  return m ? Number(m[1]) : null
}

// Pure function: extracts the numeric major version floor out of an engines.node range
// string such as ">=20".
function enginesNodeFloor(enginesNodeValue) {
  const m = String(enginesNodeValue).match(/([0-9]+)/)
  return m ? Number(m[1]) : null
}

// Pure function: true iff a package.json "test" script's `--test` glob argument is
// wrapped in quote characters (single or double).
function testScriptQuotesGlob(testScript) {
  return /--test\s+['"]/.test(testScript)
}

// Pure function: true iff a package.json "test" script's glob argument ends in
// `*.test.js` (as opposed to a bare directory or a wider `*.js` glob).
function testScriptGlobEndsInTestJs(testScript) {
  return /--test\s+['"]?\S*\*\.test\.js['"]?\s*$/.test(testScript)
}

test('AC-4: engines.node floor in package.json matches node-version pinned in ci.yml', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  const workflowText = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')

  const floor = enginesNodeFloor(pkg.engines.node)
  const pinned = workflowNodeVersion(workflowText)
  assert.ok(floor !== null, 'engines.node must contain a numeric major version')
  assert.ok(pinned !== null, 'ci.yml must pin a numeric node-version for actions/setup-node')
  assert.equal(pinned, floor, `ci.yml node-version (${pinned}) must equal package.json engines.node floor (${floor})`)
})

test('AC-5: neither test script quotes its --test glob, and both glob for *.test.js', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  const toyPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'toy', 'package.json'), 'utf8'))

  assert.equal(testScriptQuotesGlob(pkg.scripts.test), false, 'root package.json "test" script must not quote its --test glob')
  assert.equal(testScriptQuotesGlob(toyPkg.scripts.test), false, 'toy/package.json "test" script must not quote its --test glob')

  assert.ok(testScriptGlobEndsInTestJs(pkg.scripts.test), 'root package.json "test" script must glob for *.test.js')
  assert.ok(testScriptGlobEndsInTestJs(toyPkg.scripts.test), 'toy/package.json "test" script must glob for *.test.js')
})

test('AC-6: the quote check rejects the literal pre-fix scripts', () => {
  assert.equal(testScriptQuotesGlob('node --test "substrate/test/*.test.js"'), true,
    'pre-fix root script must be detected as quoted')
  assert.equal(testScriptQuotesGlob('NODE_ENV=test node --test "test/*.test.js"'), true,
    'pre-fix toy script must be detected as quoted')

  // And the fixed scripts must pass the same check.
  assert.equal(testScriptQuotesGlob('node --test substrate/test/*.test.js'), false,
    'fixed root script must not be flagged as quoted')
  assert.equal(testScriptQuotesGlob('NODE_ENV=test node --test test/*.test.js'), false,
    'fixed toy script must not be flagged as quoted')
})

test('AC-6: the floor check rejects a synthetic workflow pinning a version other than the engines.node floor', () => {
  const mismatched = [
    'jobs:',
    '  test:',
    '    steps:',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 18',
  ].join('\n')

  const pinned = workflowNodeVersion(mismatched)
  const floor = enginesNodeFloor('>=20')
  assert.equal(pinned, 18)
  assert.equal(floor, 20)
  assert.notEqual(pinned, floor, 'a synthetic workflow pinning a mismatched node-version must be caught by inequality, not silently pass')

  const matched = mismatched.replace('node-version: 18', 'node-version: 20')
  assert.equal(workflowNodeVersion(matched), floor, 'sanity: a synthetic workflow pinning the same floor must match')
})
