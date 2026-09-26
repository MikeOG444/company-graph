// AC-1: codeRisk({ touched_surfaces: [{ kind: 'path', ref: '.claude/agents/test-author.md' }] }) returns an
// empty array (no high reason) — the Risk Router must stop flagging a ref that only contains 'author'.
//
// Written from the spec (ledger/runs/k16/spec-wi-c13-b7-small-line-fixes.json) ONLY. HIGH_KINDS, HIGH_REF
// and codeRisk are extracted as source text from .claude/workflows/build-spec.js and evaluated with
// `new Function`, per AC-1's own given, the same idiom substrate/test/graph-lint-helpers.js uses for the
// graph-lint block (these declarations sit just above it, so k17-helpers.js locates them by their own
// exact anchor text, not by any first-occurrence scan of an unrelated mention).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadRiskRouter } from './k17-helpers.js'

test('AC-1: codeRisk does not flag a touched_surfaces ref naming only "author" (.claude/agents/test-author.md)', () => {
  const { codeRisk } = loadRiskRouter()
  const reasons = codeRisk({ touched_surfaces: [{ kind: 'path', ref: '.claude/agents/test-author.md' }] })
  assert.deepEqual(reasons, [])
})
