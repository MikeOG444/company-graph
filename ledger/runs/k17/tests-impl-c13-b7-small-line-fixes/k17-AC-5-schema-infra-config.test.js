// AC-5: codeRisk, called with { kind: 'schema', ref: 'contracts.schema.json' } and separately with
// { kind: 'infra', ref: 'deploy/stack.yml' }, each yields exactly one reason of the form
// 'surface kind <kind>: <ref>'; and { kind: 'config', ref: 'package.json' } yields no reason — the rule's
// shape (schema/infra high outright, other kinds only when the ref names a sensitive term) is unchanged.
//
// Written from the spec ONLY.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadRiskRouter } from './k17-helpers.js'

test('AC-5: schema/infra kinds are high outright; config with no sensitive term is not', () => {
  const { codeRisk } = loadRiskRouter()

  const schemaReasons = codeRisk({ touched_surfaces: [{ kind: 'schema', ref: 'contracts.schema.json' }] })
  assert.deepEqual(schemaReasons, ['surface kind schema: contracts.schema.json'])

  const infraReasons = codeRisk({ touched_surfaces: [{ kind: 'infra', ref: 'deploy/stack.yml' }] })
  assert.deepEqual(infraReasons, ['surface kind infra: deploy/stack.yml'])

  const configReasons = codeRisk({ touched_surfaces: [{ kind: 'config', ref: 'package.json' }] })
  assert.deepEqual(configReasons, [])
})
