// AC-11: with no ledger/ directory at all, `recost` exits 0, reports 0 rows, and creates no index.jsonl file;
// `check` on the same root also exits 0. Written from the Spec alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from './helpers.js'

test('AC-11: recost against a root with no ledger/ directory exits 0, reports 0 rows, and creates no index file; check also exits 0', () => {
  const root = tmpRoot()
  assert.ok(!fs.existsSync(path.join(root, 'ledger')), 'fixture must start with no ledger/ directory')

  const r = cli('ledger', ['recost'], { root })
  assert.equal(r.code, 0, `${r.out}\n${r.err}`)
  assert.match(r.out, /recosted 0 rows?/)
  assert.ok(!fs.existsSync(path.join(root, 'ledger', 'index.jsonl')), 'no newline-only index file should be left behind')

  const c = cli('ledger', ['check'], { root })
  assert.equal(c.code, 0, `${c.out}\n${c.err}`)
})
