// AC-2: codeRisk, called with a single path-kind surface whose ref is, in turn, 'src/auth/login.js',
// 'lib/authz.js', 'docs/authentication.md', 'api/authorization.ts', returns exactly one reason each time,
// and that reason contains the ref and the text 'surface ref names a sensitive term'.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadRiskRouter } from './k17-helpers.js'

test('AC-2: codeRisk still flags refs naming auth, authz, authentication, authorization', () => {
  const { codeRisk } = loadRiskRouter()
  const refs = ['src/auth/login.js', 'lib/authz.js', 'docs/authentication.md', 'api/authorization.ts']
  for (const ref of refs) {
    const reasons = codeRisk({ touched_surfaces: [{ kind: 'path', ref }] })
    assert.equal(reasons.length, 1, `expected exactly one reason for ${ref}`)
    assert.ok(reasons[0].includes(ref), `expected the reason for ${ref} to include the ref`)
    assert.ok(reasons[0].includes('surface ref names a sensitive term'),
      `expected the reason for ${ref} to include 'surface ref names a sensitive term'`)
  }
})
