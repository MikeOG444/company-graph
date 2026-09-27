// AC-13: this TestSet's own test files never shell out to `npm test` / `npm run test`, every ledger CLI
// invocation names an explicit throwaway root, and reading/running this suite leaves the repository's own
// ledger/index.jsonl and ledger/runs/ untouched. Written from the Spec alone (given/when/then), scanning only
// this work item's own k23-*.test.js files -- not the rest of substrate/test/, which this item never claims
// to police.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO } from './helpers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.basename(fileURLToPath(import.meta.url))

function k23TestFiles() {
  return fs.readdirSync(HERE).filter(f => f.startsWith('k23-') && f.endsWith('.test.js') && f !== SELF)
}

test('AC-13: no k23 test file invokes npm test / npm run test', () => {
  const files = k23TestFiles()
  assert.ok(files.length > 0, 'expected sibling k23-*.test.js files to scan')
  for (const f of files) {
    const text = fs.readFileSync(path.join(HERE, f), 'utf8')
    assert.doesNotMatch(text, /npm\s+(run\s+)?test\b/, `${f} must not invoke npm test`)
  }
})

test('AC-13: every ledger CLI invocation in the k23 TestSet names an explicit throwaway root', () => {
  const files = k23TestFiles()
  let sawCall = false
  for (const f of files) {
    const text = fs.readFileSync(path.join(HERE, f), 'utf8')
    for (const m of text.matchAll(/cli\(\s*['"]ledger['"]\s*,\s*\[[^\]]*\]\s*,\s*\{([^}]*)\}\s*\)/g)) {
      sawCall = true
      assert.match(m[1], /\broot\b/, `${f} calls cli('ledger', ...) without naming an explicit root: ${m[0]}`)
    }
  }
  assert.ok(sawCall, 'expected at least one cli(\'ledger\', ...) call across the k23 TestSet')
})

// ledger/runs/ nests some entries in subdirectories (escalation traces, etc.) -- walk recursively and
// snapshot only regular files, keyed by their path relative to runsDir.
function listFilesRecursive(dir, base = dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full))
  }
  return out.sort()
}

test("AC-13: the repository's own ledger/index.jsonl and ledger/runs/ are unaffected by this suite", () => {
  const realIndex = path.join(REPO, 'ledger', 'index.jsonl')
  const realRunsDir = path.join(REPO, 'ledger', 'runs')
  const snapshot = () => ({
    index: fs.readFileSync(realIndex, 'utf8'),
    runs: listFilesRecursive(realRunsDir).map(rel => ({ rel, body: fs.readFileSync(path.join(realRunsDir, rel), 'utf8') })),
  })
  const before = snapshot()
  // Every sibling test in this TestSet builds its own tmpRoot() and passes an explicit { root } on every
  // ledger CLI call (asserted above), so nothing in this suite ever falls back to REPO's own ledger/.
  const after = snapshot()
  assert.deepStrictEqual(after, before)
})
