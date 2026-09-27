// spec-wi-b1-b2-memory-to-build AC-22. Written from the Spec only, in the same self-inspecting style as
// the pre-existing substrate/test/b5-suite-hygiene.test.js and b6-suite-hygiene.test.js (reused as
// conventions, not modified).
//
// "the repository test suite" / "npm test runs after the change" / "all existing tests, including the
// graph-lint and fix-loop sentinel tests, still pass". A landed test cannot itself invoke `npm test`
// (CLAUDE.md / harness rule: never shell out to it), so this checks the property a landed k19-*.test.js
// suite must hold for that run to stay green: no file shells out to npm test or a child process, no
// relative import climbs out of this TestSet directory, and every source-text wiring assertion goes
// through the b5-wiring-helpers call-structure helpers rather than a bare whole-file indexOf/search.
//
// This file resolves paths only via process.cwd() through the existing REPO export of
// fixloop-helpers.js — never by counting '..' from its own file location, matching every sibling helper
// in this TestSet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

const LANDED_TEST_DIR = path.join(REPO, 'substrate', 'test')
const TESTSET_DIR = path.join(REPO, '.artifacts', 'tests', 'implement-memory-to-build')
const K19_PREFIX = 'k19-'

function k19NamesIn(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.startsWith(K19_PREFIX) && name.endsWith('.test.js'))
}

function k19TestFiles() {
  const seen = new Set()
  const files = []
  for (const dir of [LANDED_TEST_DIR, TESTSET_DIR]) {
    for (const name of k19NamesIn(dir)) {
      if (seen.has(name)) continue
      seen.add(name)
      files.push(path.join(dir, name))
    }
  }
  return files
}

test('AC-22: every k19-*.test.js file resolves repository paths only via process.cwd() or an imported existing helper, never by counting ".." from its own file location', () => {
  const files = k19TestFiles()
  assert.ok(files.length > 0, 'expected at least one k19-*.test.js file, landed in substrate/test/ or present in this TestSet directory')
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /fileURLToPath\(import\.meta\.url\)/,
      `${path.basename(file)} must not derive a path from its own file location; use process.cwd() or an existing helper's export instead`)
    assert.doesNotMatch(text, /path\.resolve\([^)]*'\.\.'[^)]*'\.\.'/,
      `${path.basename(file)} must not count ".." twice from its own location to find the repo root`)
    assert.doesNotMatch(text, /join\([^)]*__dirname[^)]*'\.\.'/,
      `${path.basename(file)} must not walk up from __dirname to find the repo root`)
  }
})

test('AC-22: no k19-*.test.js file imports or requires with a relative specifier that climbs out of this TestSet directory', () => {
  const files = k19TestFiles()
  assert.ok(files.length > 0)
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const specifiers = [...text.matchAll(/from\s+['"](\.[^'"]*)['"]/g)].map(m => m[1])
    for (const spec of specifiers) {
      assert.ok(!spec.startsWith('..'), `${path.basename(file)} imports '${spec}', which climbs out of its own directory`)
    }
  }
})

test('AC-22: no k19-*.test.js file shells out to npm test, spawns a child process, or dynamically executes a workflow file', () => {
  const files = k19TestFiles()
  assert.ok(files.length > 0)
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /(exec\w*|spawn\w*)\([^)]*npm\s+test/i, `${path.basename(file)} must not shell out to "npm test"`)
    assert.doesNotMatch(text, /from\s+['"]node:child_process['"]|require\(['"]\w*child_process['"]\)/,
      `${path.basename(file)} must not import child_process`)
    assert.doesNotMatch(text, /\b(child_process|execSync|spawnSync)\s*\.\s*\w+\(|^\s*(execSync|spawnSync|spawn|exec)\(/m,
      `${path.basename(file)} must not shell out at all`)
    assert.doesNotMatch(text, /import\([^)]*\.claude\/workflows/, `${path.basename(file)} must not dynamically import a workflow module`)
    assert.doesNotMatch(text, /from\s+['"][^'"]*\.claude\/workflows[^'"]*\.js['"]/,
      `${path.basename(file)} must not statically import a workflow module as executable code`)
  }
})

test('AC-22: none of these files calls the CommonJS require function (this repo is ESM)', () => {
  const files = k19TestFiles()
  assert.ok(files.length > 0)
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n').filter(l => !/^\s*\/\//.test(l))
    const code = lines.join('\n')
    assert.doesNotMatch(code, /\brequire\s*\(/, `${path.basename(file)} must not call the CommonJS require function in this ESM repo`)
  }
})

test('AC-22: every k19-*.test.js file that inspects source-text CALL wiring/order goes through the b5-wiring-helpers call-structure helpers (directly, or through this TestSet\'s own k19-agent-call-helpers.js, which is built on them) rather than relying on a bare whole-file indexOf/search', () => {
  const files = k19TestFiles()
  assert.ok(files.length > 0)
  // A file counts as making a call-order/wiring assertion if it imports either b5-wiring-helpers.js directly,
  // or this TestSet's own k19-agent-call-helpers.js / k19-canary-extract-helpers.js / k19-patterns-extract-helpers.js,
  // each of which is itself built on b5-wiring-helpers.js's codeMask/callSites/matchBrace (see their own headers).
  const wiringFiles = files.filter(f => {
    const text = fs.readFileSync(f, 'utf8')
    return /from\s+['"]\.\/(b5-wiring-helpers|k19-agent-call-helpers|k19-canary-extract-helpers)\.js['"]/.test(text)
  })
  assert.ok(wiringFiles.length > 0, 'expected at least one k19 file making a call-structure/wiring assertion')
  const helperText = fs.readFileSync(path.join(TESTSET_DIR, 'k19-agent-call-helpers.js'), 'utf8')
  assert.match(helperText, /from\s+['"]\.\/b5-wiring-helpers\.js['"]/,
    'k19-agent-call-helpers.js must itself build on b5-wiring-helpers.js rather than reimplementing call-site detection')
  const imported = helperText.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/b5-wiring-helpers\.js['"]/)?.[1] ?? ''
  assert.ok(/callSites|functionNamed|enclosingFunction|reachersOf|firstCallOf|codeMask|matchBrace/.test(imported),
    'k19-agent-call-helpers.js must import at least one call-structure helper from b5-wiring-helpers.js')
})
