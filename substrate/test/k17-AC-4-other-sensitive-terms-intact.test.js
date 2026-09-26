// AC-4: codeRisk, called with path-kind refs naming each of the other existing sensitive terms
// ('src/token.js', 'cfg/secret.json', 'lib/credential.js', 'lib/password.js', 'src/payment.js',
// 'src/billing.js', 'db/migrations/001.sql'), still yields exactly one high reason each (no existing term
// was dropped by the author/authored/authority refinement).
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadRiskRouter } from './k17-helpers.js'

test('AC-4: token/secret/credential/password/payment/billing/migrat terms are still flagged', () => {
  const { codeRisk } = loadRiskRouter()
  const refs = [
    'src/token.js', 'cfg/secret.json', 'lib/credential.js', 'lib/password.js',
    'src/payment.js', 'src/billing.js', 'db/migrations/001.sql',
  ]
  for (const ref of refs) {
    const reasons = codeRisk({ touched_surfaces: [{ kind: 'path', ref }] })
    assert.equal(reasons.length, 1, `expected exactly one reason for ${ref}`)
  }
})
