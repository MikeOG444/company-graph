// Tests for spec-wi-b6-test-validity-before-blame AC-16: this TestSet's own b6-*.test.js files resolve
// repository paths only via process.cwd() or an existing extractor (extract-fixloop.js / fixloop-helpers.js
// REPO), never by counting ".." from a test file's own location; none of them shells out to `npm test` or
// spawns a child process; and any source-text wiring assertion uses the b5-wiring-helpers call-structure
// helpers rather than a whole-file indexOf of a function name's first textual occurrence.
//
// Written from the spec ONLY, in the same self-inspecting style as the pre-existing
// substrate/test/b5-suite-hygiene.test.js (which this file cannot modify — it is reused as-is per the
// spec's exclusions — so a parallel b6- version covers the same property for this work item's own files).
//
// AC-16's "given" is tests "added under substrate/test/" — that is where this suite is landed once the
// work item integrates. But per build-implement.js's per-round Test Runner (see fixloop-helpers.js's own
// comment on REPO), THIS file runs earlier too: pointed straight at this TestSet directory, before any
// landing step has copied its siblings into substrate/test/. A bare `substrate/test/` scan is therefore
// empty in that pre-landing worktree — not because the siblings are missing, but because this file was
// checking the wrong location for the stage it was actually running in. So this looks in EITHER place a
// sibling b6-*.test.js can legitimately be at test-run time: the landed substrate/test/ directory, or this
// TestSet's own directory (a literal repository-relative path — a known constant of this work item, not a
// path counted with ".." from this file's own on-disk location, which the property below itself forbids).
// Repository paths are resolved only via process.cwd() (through the existing REPO export of
// fixloop-helpers.js) — never via import.meta.url or counting ".." from this file's own location.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

const LANDED_TEST_DIR = path.join(REPO, 'substrate', 'test')
const TESTSET_DIR = path.join(REPO, '.artifacts', 'tests', 'implement-test-validity-classification')
const B6_PREFIX = 'b6-'

function b6NamesIn(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.startsWith(B6_PREFIX) && name.endsWith('.test.js'))
}

function b6TestFiles() {
  const seen = new Set()
  const files = []
  for (const dir of [LANDED_TEST_DIR, TESTSET_DIR]) {
    for (const name of b6NamesIn(dir)) {
      if (seen.has(name)) continue
      seen.add(name)
      files.push(path.join(dir, name))
    }
  }
  return files
}

test('AC-16: every b6-*.test.js file resolves repository paths only via process.cwd() or an imported existing helper, never by counting ".." from its own file location', () => {
  const files = b6TestFiles()
  assert.ok(files.length > 0, 'expected at least one b6-*.test.js file, landed in substrate/test/ or present in this TestSet directory')

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

test('AC-16: no b6-*.test.js file shells out to npm test, spawns a child process, or dynamically executes a workflow file', () => {
  const files = b6TestFiles()
  assert.ok(files.length > 0)

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /(exec\w*|spawn\w*)\([^)]*npm\s+test/i,
      `${path.basename(file)} must not shell out to "npm test"`)
    assert.doesNotMatch(text, /from\s+['"]node:child_process['"]|require\(['"]\w*child_process['"]\)/,
      `${path.basename(file)} must not import child_process`)
    assert.doesNotMatch(text, /\b(child_process|execSync|spawnSync)\s*\.\s*\w+\(|^\s*(execSync|spawnSync|spawn|exec)\(/m,
      `${path.basename(file)} must not shell out at all`)
    assert.doesNotMatch(text, /import\([^)]*\.claude\/workflows/, `${path.basename(file)} must not dynamically import a workflow module`)
    assert.doesNotMatch(text, /from\s+['"][^'"]*\.claude\/workflows[^'"]*\.js['"]/,
      `${path.basename(file)} must not statically import a workflow module as executable code`)
  }
})

test('AC-16: none of these files calls the CommonJS require function (this repo is ESM — "type": "module" — and calling it would crash the suite, not merely violate style)', () => {
  const files = b6TestFiles()
  assert.ok(files.length > 0)
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n').filter(l => !/^\s*\/\//.test(l))
    const code = lines.join('\n')
    assert.doesNotMatch(code, /\brequire\s*\(/, `${path.basename(file)} must not call the CommonJS require function in this ESM repo`)
  }
})

test('AC-16: every b6-*.test.js file that inspects source-text CALL wiring imports the b5-wiring-helpers call-structure helpers rather than relying on a bare whole-file indexOf/search of a function name', () => {
  const files = b6TestFiles()
  assert.ok(files.length > 0)
  const wiringFiles = files.filter(f => /wiring/.test(path.basename(f)))
  assert.ok(wiringFiles.length > 0, 'expected at least one b6 wiring test file')
  for (const file of wiringFiles) {
    const text = fs.readFileSync(file, 'utf8')
    assert.match(text, /from\s+['"]\.\/b5-wiring-helpers\.js['"]/, `${path.basename(file)} must import from ./b5-wiring-helpers.js`)
    const imported = text.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/b5-wiring-helpers\.js['"]/)?.[1] ?? ''
    assert.ok(/callSites|functionNamed|enclosingFunction|reachersOf|firstCallOf/.test(imported),
      `${path.basename(file)} must import at least one call-structure helper (functionNamed/enclosingFunction/callSites/reachersOf/firstCallOf)`)
  }
})
