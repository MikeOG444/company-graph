// AC-14: contracts.schema.json's Finding gains one optional `target` property (enum
// ['implementation','test']), not required, and the inlined Finding copy in
// build-implement.js matches; Escalation (including its five-value reason enum) is
// unchanged from HEAD.
//
// Written from the spec (.artifacts/build/t7/specs/spec-wi-owned-surfaces-boundary.json)
// only. Lands in substrate/test/ and runs under the repo's `npm test`
// (node --test "substrate/test/*.test.js").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validate } from '../lib/contracts.js'
import { REPO, cli, tmpRoot } from './helpers.js'
import { readWorkflowText } from './extract-fixloop.js'

test('AC-14: Finding.target is optional, enum ["implementation","test"], and Escalation is unchanged at HEAD', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'contracts.schema.json'), 'utf8'))
  const findingDef = schema.$defs.Finding
  assert.deepEqual(findingDef.properties.target?.enum, ['implementation', 'test'])
  assert.ok(!(findingDef.required ?? []).includes('target'), 'target must not be in Finding.required')

  assert.deepEqual(
    schema.$defs.Escalation.properties.reason.enum,
    ['max_rounds', 'repeat_finding', 'budget', 'no_fresh_findings', 'cannot_repro'],
    'Escalation, including its five-value reason enum, must be unchanged from HEAD',
  )
})

test('AC-14: the inlined Finding schema in build-implement.js matches the new optional target property', () => {
  const text = readWorkflowText()
  assert.match(
    text,
    /target:\s*\{\s*enum:\s*\[\s*'implementation'\s*,\s*'test'\s*\]\s*\}/,
    'the inlined Finding schema in build-implement.js must carry the same optional target enum as the contract',
  )
  // The inlined Finding's required list (unchanged from HEAD) must not gain target.
  const findingIdx = text.indexOf("const Finding = { type: 'object'")
  assert.ok(findingIdx >= 0, 'expected the existing inlined Finding schema')
  const findingBlock = text.slice(findingIdx, text.indexOf('const Verdict', findingIdx))
  assert.doesNotMatch(findingBlock.slice(0, findingBlock.indexOf('properties:')), /'target'/,
    'target must not be added to the inlined Finding\'s required list')
})

test('AC-14: a Finding without target, and a Finding with target "test", both validate against the Finding contract', () => {
  const withoutTarget = {
    id: 'f1', lens: 'security', severity: 'medium', location: 'src/app.js:1',
    claim: 'claim', evidence: 'evidence', dedupe_key: 'k1', status: 'open',
  }
  const withTarget = { ...withoutTarget, id: 'f2', dedupe_key: 'k2', target: 'test' }

  const r1 = validate('Finding', withoutTarget)
  assert.equal(r1.ok, true, JSON.stringify(r1.errors))
  const r2 = validate('Finding', withTarget)
  assert.equal(r2.ok, true, JSON.stringify(r2.errors))
})

test('AC-14: the same two Findings validate through the CLI exactly as the acceptance criterion describes (node substrate/validator.js Finding <file>)', () => {
  const root = tmpRoot()
  const withoutTarget = {
    id: 'f1', lens: 'security', severity: 'medium', location: 'src/app.js:1',
    claim: 'claim', evidence: 'evidence', dedupe_key: 'k1', status: 'open',
  }
  const withTarget = { ...withoutTarget, id: 'f2', dedupe_key: 'k2', target: 'test' }

  const p1 = path.join(root, 'finding-without-target.json')
  fs.writeFileSync(p1, JSON.stringify(withoutTarget))
  const p2 = path.join(root, 'finding-with-target.json')
  fs.writeFileSync(p2, JSON.stringify(withTarget))

  const r1 = cli('validator', ['Finding', p1], { root })
  assert.equal(r1.code, 0, r1.out + r1.err)
  const r2 = cli('validator', ['Finding', p2], { root })
  assert.equal(r2.code, 0, r2.out + r2.err)
})
