// AC-3: HIGH_REF (or codeRisk), applied to 'lib/authn.js', 'src/authenticate.js', 'src/authenticated.js',
// 'docs/authorisation.md', 'docs/AUTH.md' matches every one of them (yields a high reason), and applied to
// 'docs/author.md', 'src/authored.js', 'docs/authority.md', '.claude/agents/test-author.md' matches none of
// them (yields no reason).
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadRiskRouter } from './k17-helpers.js'

test('AC-3: authn/authenticate(d)/authorisation/AUTH match; author/authored/authority/test-author do not', () => {
  const { codeRisk } = loadRiskRouter()
  const matched = ['lib/authn.js', 'src/authenticate.js', 'src/authenticated.js', 'docs/authorisation.md', 'docs/AUTH.md']
  const unmatched = ['docs/author.md', 'src/authored.js', 'docs/authority.md', '.claude/agents/test-author.md']

  for (const ref of matched) {
    const reasons = codeRisk({ touched_surfaces: [{ kind: 'path', ref }] })
    assert.equal(reasons.length, 1, `expected ${ref} to yield a high reason`)
  }
  for (const ref of unmatched) {
    const reasons = codeRisk({ touched_surfaces: [{ kind: 'path', ref }] })
    assert.deepEqual(reasons, [], `expected ${ref} to yield no reason`)
  }
})
