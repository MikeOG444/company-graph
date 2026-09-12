// Verification for spec-wi-c4-ci / task t1-ci-workflow: .github/workflows/ci.yml runs
// both committed test suites (root "npm test" and toy/'s "npm test") on every push and
// pull_request, unattended, on a fresh checkout.
//
// The repository's only YAML-adjacent dependencies are ajv and ajv-formats (a JSON
// Schema validator, not a YAML parser) and adding one is out of scope for this work
// item, so every structural assertion below reads .github/workflows/ci.yml as plain
// text and checks it with regex / line-shape assertions, in the style of
// substrate/test/AC-17-implementer-boundary-doc.test.js. AC-15 additionally exercises
// real execution behavior: it copies the repository (minus node_modules, .git and this
// test file itself, to avoid re-entrant recursion) into a throwaway directory and runs
// the exact install/test commands the workflow declares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOWS_DIR = path.join(REPO, '.github', 'workflows')
const WORKFLOW_PATH = path.join(WORKFLOWS_DIR, 'ci.yml')
const SELF_FILENAME = path.basename(fileURLToPath(import.meta.url))

function readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8')
}

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length
}

// Returns the text of the block starting at the first line matching headerRegex
// (inclusive) up to (exclusive) the next non-blank line whose indentation is <= the
// header line's indentation. Works for both top-level keys (name:, on:, jobs:) and
// nested keys (push:, branches:, with:), since YAML block scope is indentation-based.
function extractBlock(text, headerRegex) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => headerRegex.test(l))
  if (start === -1) return null
  const base = indentOf(lines[start])
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (indentOf(lines[i]) <= base) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

test('AC-1: exactly one workflow file, non-empty, no tabs, three top-level keys at column 0', () => {
  const files = fs.readdirSync(WORKFLOWS_DIR)
  assert.deepEqual(files, ['ci.yml'], 'exactly one file must exist at .github/workflows/')

  const text = readWorkflow()
  assert.ok(text.length > 0, 'workflow file must be non-empty')
  assert.ok(!text.includes('\t'), 'workflow file must contain no tab characters')
  assert.match(text, /^name:/m, 'must have a top-level name: key at column 0')
  assert.match(text, /^(on:|"on":|'on':)/m, 'must have a top-level on trigger key at column 0')
  assert.match(text, /^jobs:/m, 'must have a top-level jobs: key at column 0')
})

test('AC-2: on: declares push and pull_request, and push carries no excluding branch allowlist', () => {
  const text = readWorkflow()
  const onBlock = extractBlock(text, /^(on:|"on":|'on':)/)
  assert.ok(onBlock, 'on: block must exist')
  assert.match(onBlock, /^\s*push:/m, 'on: must declare push')
  assert.match(onBlock, /^\s*pull_request:/m, 'on: must declare pull_request')

  const pushBlock = extractBlock(onBlock, /^\s*push:/)
  const branchesBlock = pushBlock ? extractBlock(pushBlock, /^\s*branches:/) : null
  if (branchesBlock) {
    const items = branchesBlock
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    assert.equal(items.length, 1, 'if push declares branches:, it must list exactly one entry')
    assert.match(items[0], /^-\s*['"]?\*\*['"]?\s*$/, "the only branches: entry must be the '**' wildcard")
  }
})

test('AC-3: only actions/checkout and actions/setup-node are used, each pinned to a major version tag', () => {
  const text = readWorkflow()
  const uses = [...text.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map((m) => m[1])
  assert.ok(uses.length > 0, 'the workflow must use at least one action')
  for (const ref of uses) {
    assert.match(
      ref,
      /^actions\/(checkout|setup-node)@v[0-9]+$/,
      `uses: ${ref} must be actions/checkout or actions/setup-node pinned to @v<major> exactly`,
    )
  }
})

test('AC-4: actions/setup-node sets node-version to 20, matching engines.node ">=20"', () => {
  const text = readWorkflow()
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  assert.equal(pkg.engines.node, '>=20', 'sanity: package.json engines.node must be ">=20"')

  const lines = text.split('\n')
  const idx = lines.findIndex((l) => /uses:\s*actions\/setup-node@v[0-9]+/.test(l))
  assert.ok(idx !== -1, 'an actions/setup-node step must exist')
  const window = lines.slice(idx, idx + 8).join('\n')
  assert.match(window, /with:/, 'actions/setup-node step must carry a with: block')
  assert.match(window, /node-version:\s*['"]?20['"]?\s*$/m, 'node-version must be set to 20 exactly, not a range or node-version-file')
  assert.ok(!/node-version-file/.test(window), 'must not use node-version-file')
})

test('AC-5: npm ci runs against the repository root before the root suite step', () => {
  const text = readWorkflow()
  const lines = text.split('\n')
  const rootInstall = lines.findIndex((l) => /^\s*run:\s*npm ci\s*$/.test(l))
  assert.ok(rootInstall !== -1, 'a step must run `npm ci` against the repository root')
  const rootSuite = lines.findIndex((l) => /^\s*run:\s*npm test(\s+--)?\s*$/.test(l))
  assert.ok(rootSuite !== -1, 'a step must run the root suite')
  assert.ok(rootInstall < rootSuite, 'the root `npm ci` step must appear before the root suite step')
})

test('AC-6: npm ci runs against toy/ before the toy suite step', () => {
  const text = readWorkflow()
  const lines = text.split('\n')
  const toyInstall = lines.findIndex((l) => /^\s*run:\s*cd toy(?:\/)? && npm ci\s*$/.test(l))
  const toyInstallAlt = lines.findIndex((l, i) => /^\s*run:\s*npm ci\s*$/.test(l) && /working-directory:\s*toy\/?\s*$/.test(lines[i - 1] || '') || /working-directory:\s*toy\/?\s*$/.test(lines[i + 1] || ''))
  const toyInstallIdx = toyInstall !== -1 ? toyInstall : toyInstallAlt
  assert.ok(toyInstallIdx !== -1 && toyInstallIdx !== undefined, 'a step must run `npm ci` against toy/')

  const toySuite = lines.findIndex((l) => /^\s*run:\s*cd toy(?:\/)? && npm test\s*$/.test(l))
  assert.ok(toySuite !== -1, 'a step must run the toy suite as `cd toy && npm test` (or npm test with working-directory: toy)')
  assert.ok(toyInstallIdx < toySuite, 'the toy `npm ci` step must appear before the toy suite step')
})

test('AC-7: the root suite step is its own named step invoking `npm test` unmodified', () => {
  const text = readWorkflow()
  const lines = text.split('\n')
  const rootSuiteIdx = lines.findIndex((l) => /^\s*run:\s*npm test(\s+--)?\s*$/.test(l))
  assert.ok(rootSuiteIdx !== -1, 'root suite step must exist')
  assert.ok(!/cd toy/.test(lines[rootSuiteIdx]), 'root suite run: must not reference toy/')

  // Walk backwards to the start of this step (the nearest `- name:` / `-name:` list item).
  let stepStart = rootSuiteIdx
  while (stepStart > 0 && !/^\s*-\s*name:/.test(lines[stepStart])) stepStart--
  const nameLine = lines[stepStart]
  assert.match(nameLine, /^\s*-\s*name:/, 'root suite step must have its own name:')
  assert.match(nameLine, /root|substrate/i, "the root suite step's name must identify it as the root/substrate suite")

  const stepBlock = lines.slice(stepStart, rootSuiteIdx + 1).join('\n')
  assert.ok(!/working-directory:\s*(?!\.\s*$)\S/.test(stepBlock), 'root suite step must not set a working-directory other than .')
  assert.ok(!/node --test/.test(stepBlock), 'root suite step must invoke the npm script, not re-spell node --test')
})

test('AC-8: the toy suite step is separate, its own name, invoking the toy `npm test` script unmodified', () => {
  const text = readWorkflow()
  const lines = text.split('\n')
  const toySuiteIdx = lines.findIndex((l) => /^\s*run:\s*cd toy(?:\/)? && npm test\s*$/.test(l))
  assert.ok(toySuiteIdx !== -1, 'toy suite step must exist')

  let stepStart = toySuiteIdx
  while (stepStart > 0 && !/^\s*-\s*name:/.test(lines[stepStart])) stepStart--
  const nameLine = lines[stepStart]
  assert.match(nameLine, /^\s*-\s*name:/, 'toy suite step must have its own name:')
  assert.match(nameLine, /toy/i, "the toy suite step's name must identify it as the toy suite")

  const rootSuiteIdx = lines.findIndex((l) => /^\s*run:\s*npm test(\s+--)?\s*$/.test(l) && !/cd toy/.test(l))
  let rootStepStart = rootSuiteIdx
  while (rootStepStart > 0 && !/^\s*-\s*name:/.test(lines[rootStepStart])) rootStepStart--
  assert.notEqual(lines[stepStart].trim(), lines[rootStepStart].trim(), 'toy suite step name must be distinct from the root suite step name')

  const stepBlock = lines.slice(stepStart, toySuiteIdx + 1).join('\n')
  assert.ok(!/node --test/.test(stepBlock), 'toy suite step must invoke the npm script, not re-spell node --test')
  assert.ok(!/NODE_ENV=test/.test(stepBlock), 'toy suite step must not re-spell NODE_ENV=test (that lives in toy/package.json)')
})

test('AC-9: the root suite and toy suite commands are two separate steps', () => {
  const text = readWorkflow()
  const lines = text.split('\n')
  const rootSuiteIdx = lines.findIndex((l) => /^\s*run:\s*npm test(\s+--)?\s*$/.test(l) && !/cd toy/.test(l))
  const toySuiteIdx = lines.findIndex((l) => /^\s*run:\s*cd toy(?:\/)? && npm test\s*$/.test(l))
  assert.ok(rootSuiteIdx !== -1 && toySuiteIdx !== -1, 'both suite steps must exist')
  assert.notEqual(rootSuiteIdx, toySuiteIdx, 'root suite and toy suite commands must be on different run: lines')

  // There must be a step boundary (another `- name:` / `- uses:` list item) between them.
  const lo = Math.min(rootSuiteIdx, toySuiteIdx)
  const hi = Math.max(rootSuiteIdx, toySuiteIdx)
  const between = lines.slice(lo + 1, hi)
  assert.ok(between.some((l) => /^\s*-\s*(name|uses|run):/.test(l)), 'a step boundary must separate the two suite commands')
})

test('AC-10: no continue-on-error and no failure-swallowing construct on install/suite steps', () => {
  const text = readWorkflow()
  assert.ok(!/continue-on-error:\s*true/.test(text), 'must not carry continue-on-error: true')
  for (const pattern of [/\|\|\s*true/, /\|\|\s*:/, /\|\|\s*exit 0/, /set \+e/]) {
    assert.ok(!pattern.test(text), `must not contain a failure-swallowing construct matching ${pattern}`)
  }
})

test('AC-11: exactly one job, runs-on: ubuntu-latest, no strategy/matrix', () => {
  const text = readWorkflow()
  const jobsBlock = extractBlock(text, /^jobs:/)
  assert.ok(jobsBlock, 'jobs: block must exist')
  const jobLines = jobsBlock.split('\n').slice(1).filter((l) => /^ {2}\S[^:]*:\s*$/.test(l))
  assert.equal(jobLines.length, 1, 'exactly one job must be declared under jobs:')

  const runsOnMatches = [...text.matchAll(/^\s*runs-on:\s*(\S+)/gm)]
  assert.equal(runsOnMatches.length, 1, 'exactly one runs-on: must be declared')
  assert.equal(runsOnMatches[0][1], 'ubuntu-latest', 'the job must run on ubuntu-latest')

  assert.ok(!/^\s*strategy:/m.test(text), 'must not declare a strategy: key')
  assert.ok(!/^\s*matrix:/m.test(text), 'must not declare a matrix: key')
})

test('AC-12: no out-of-scope machinery (cache, lint, coverage, deploy/publish/release, secrets)', () => {
  const text = readWorkflow()
  const forbidden = [
    /cache:/, /cache-dependency-path:/,
    /npm run lint/, /\beslint\b/, /--coverage/, /\bc8\b/, /\bnyc\b/,
    /npm publish/, /actions\/upload-artifact/, /softprops\/action-gh-release/, /gh release/,
    /secrets\./,
  ]
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(text), `workflow must not contain out-of-scope machinery matching ${pattern}`)
  }
})

test('AC-13: no hardcoded passing-test count anywhere in the workflow', () => {
  const text = readWorkflow()
  assert.ok(!/\b105\b/.test(text), 'must not assert the stale root count of 105')
  assert.ok(!/\b114\b/.test(text), 'must not assert the current root count of 114')
  assert.ok(!/passing/i.test(text), 'must not assert any specific passing-test count')
})

test('AC-14: both package-lock.json files are tracked; neither node_modules directory is tracked', () => {
  const tracked = (p) => spawnSync('git', ['ls-files', '--error-unmatch', p], { cwd: REPO, encoding: 'utf8' }).status === 0
  assert.ok(tracked('package-lock.json'), './package-lock.json must be tracked by git')
  assert.ok(tracked('toy/package-lock.json'), './toy/package-lock.json must be tracked by git')

  const rootNodeModules = spawnSync('git', ['ls-files', 'node_modules'], { cwd: REPO, encoding: 'utf8' }).stdout.trim()
  const toyNodeModules = spawnSync('git', ['ls-files', 'toy/node_modules'], { cwd: REPO, encoding: 'utf8' }).stdout.trim()
  assert.equal(rootNodeModules, '', './node_modules must not be tracked by git')
  assert.equal(toyNodeModules, '', './toy/node_modules must not be tracked by git')
})

test('AC-15: on a fresh checkout, the declared install and suite commands succeed with zero failures', { timeout: 300000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ci-'))
  try {
    fs.cpSync(REPO, tmp, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(REPO, src)
        if (rel === '') return true
        const parts = rel.split(path.sep)
        // .git is kept: a real actions/checkout leaves .git in place, and at least one
        // existing root test (deploy.test.js) shells out to git (e.g. to resolve HEAD),
        // so a fresh checkout that omits it is not a faithful simulation.
        if (parts[0] === '.artifacts') return false
        if (parts.includes('node_modules')) return false
        // Exclude this very test file from the copy, so the copy's own `npm test`
        // does not recursively re-run this fresh-checkout simulation.
        if (rel === path.join('substrate', 'test', SELF_FILENAME)) return false
        return true
      },
    })
    assert.ok(!fs.existsSync(path.join(tmp, 'node_modules')), 'sanity: fresh checkout must have no root node_modules')
    assert.ok(!fs.existsSync(path.join(tmp, 'toy', 'node_modules')), 'sanity: fresh checkout must have no toy node_modules')

    // This test file is itself running under `node --test`, which marks the process
    // environment with NODE_TEST_CONTEXT. That variable is inherited by spawnSync's
    // children by default and makes a child `node --test` invocation believe it is a
    // recursive/nested run and skip executing its files entirely. Strip it (and any
    // other NODE_TEST_* markers) so the copy's own `npm test` actually runs its suite.
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST_')))

    const rootInstall = spawnSync('npm', ['ci'], { cwd: tmp, encoding: 'utf8', env: childEnv })
    assert.equal(rootInstall.status, 0, `root npm ci must succeed:\n${rootInstall.stderr}`)

    const toyInstall = spawnSync('npm', ['ci'], { cwd: path.join(tmp, 'toy'), encoding: 'utf8', env: childEnv })
    assert.equal(toyInstall.status, 0, `toy npm ci must succeed:\n${toyInstall.stderr}`)

    const rootTest = spawnSync('npm', ['test'], { cwd: tmp, encoding: 'utf8', env: childEnv })
    assert.equal(rootTest.status, 0, `root suite must exit 0:\n${rootTest.stdout}\n${rootTest.stderr}`)
    assert.match(rootTest.stdout + rootTest.stderr, /# fail 0/, 'root suite must report zero failures')

    const toyTest = spawnSync('npm', ['test'], { cwd: path.join(tmp, 'toy'), encoding: 'utf8', env: childEnv })
    assert.equal(toyTest.status, 0, `toy suite must exit 0:\n${toyTest.stdout}\n${toyTest.stderr}`)
    assert.match(toyTest.stdout + toyTest.stderr, /# fail 0/, 'toy suite must report zero failures')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
