// AC-12: substrate/ledger.js's usage header comment block and its default-branch die('usage: ...') message
// both list the new `check` subcommand alongside append|list|show|summary|recost, and the header's recost
// documentation names cost_est_usd as the (only) thing recost rewrites in both the index line and the run
// file entry. Written from the Spec's own wording alone; matched with \s+ rather than exact line wraps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './helpers.js'

const SRC = fs.readFileSync(path.join(REPO, 'substrate', 'ledger.js'), 'utf8')

// The usage header is the leading run of `//` comment lines before the first `import`.
const headerEnd = SRC.indexOf('\nimport ')
const header = headerEnd === -1 ? SRC : SRC.slice(0, headerEnd)

// The default-branch die('usage: ...') call.
const dieMatch = SRC.match(/default:\s*[\s\S]*?die\((['"`])([\s\S]*?)\1/)

test('AC-12: the usage header documents the check subcommand alongside the existing ones', () => {
  assert.match(header, /\bcheck\b/, 'header must mention the check subcommand')
  for (const word of ['append', 'list', 'show', 'summary', 'recost']) {
    assert.match(header, new RegExp(`\\b${word}\\b`), `header must still mention ${word}`)
  }
})

test('AC-12: the usage header documents recost as rewriting cost_est_usd in both the index line and the run file entry', () => {
  const recostIdx = header.search(/\brecost\b/)
  assert.ok(recostIdx > -1, 'header must have a recost entry')
  const nearRecost = header.slice(recostIdx, recostIdx + 400)
  assert.match(nearRecost, /cost_est_usd/, 'the recost documentation must name cost_est_usd')
})

test('AC-12: the default-branch die() usage message names the check subcommand alongside append|list|show|summary|recost', () => {
  assert.ok(dieMatch, `expected a default-branch die('usage: ...') call in:\n${SRC.slice(-400)}`)
  const msg = dieMatch[2]
  assert.match(msg, /\bcheck\b/)
  for (const word of ['append', 'list', 'show', 'summary', 'recost']) {
    assert.match(msg, new RegExp(`\\b${word}\\b`), `usage message must still mention ${word}`)
  }
})
