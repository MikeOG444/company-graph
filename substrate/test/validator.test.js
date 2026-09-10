import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { validate, listDefs } from '../lib/contracts.js'
import { cli, FIX } from './helpers.js'

test('every $def compiles', () => {
  for (const d of listDefs()) validate(d, {})
})

test('valid EvidenceBundle passes (lib)', () => {
  const r = validate('EvidenceBundle', JSON.parse(await_read('evidence-bundle.valid.json')))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('invalid EvidenceBundle names the missing field, the missing nested provenance, and the extra field', () => {
  const r = validate('EvidenceBundle', JSON.parse(await_read('evidence-bundle.invalid.json')))
  assert.equal(r.ok, false)
  const msgs = r.errors.map(e => `${e.path}: ${e.message}`)
  assert.ok(msgs.some(m => m.includes('missing required property "suite"')), msgs.join('\n'))
  assert.ok(msgs.some(m => m.includes('/panel_results/0/verdicts/0') && m.includes('"provenance"')), msgs.join('\n'))
  assert.ok(msgs.some(m => m.includes('unexpected property "extra_field"')), msgs.join('\n'))
})

test('unknown def is an error', () => {
  assert.throws(() => validate('NoSuchThing', {}), /unknown contract/)
})

test('CLI exit codes: 0 valid, 1 invalid, 2 usage', () => {
  assert.equal(cli('validator', ['EvidenceBundle', path.join(FIX, 'evidence-bundle.valid.json')]).code, 0)
  const bad = cli('validator', ['EvidenceBundle', path.join(FIX, 'evidence-bundle.invalid.json')])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /INVALID EvidenceBundle/)
  assert.match(bad.out, /suite/)
  assert.equal(cli('validator', ['EvidenceBundle']).code, 2)
  assert.equal(cli('validator', ['Nope', path.join(FIX, 'evidence-bundle.valid.json')]).code, 2)
})

test('CLI reads from stdin with -', () => {
  const r = cli('validator', ['Surface', '-'], { input: '{"kind":"path","ref":"src/a.js"}' })
  assert.equal(r.code, 0)
})

import fs from 'node:fs'
function await_read(f) { return fs.readFileSync(path.join(FIX, f), 'utf8') }
