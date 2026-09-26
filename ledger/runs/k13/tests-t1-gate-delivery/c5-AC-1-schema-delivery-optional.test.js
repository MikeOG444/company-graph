// AC-1: contracts.schema.json gains an optional `delivery` property on GateRecord; every existing
// gates/closed/*.json record still validates.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'

test('AC-1: delivery is an optional, tightly-shaped property on GateRecord', async () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'contracts.schema.json'), 'utf8'))
  const gr = schema.$defs.GateRecord
  assert.ok(gr, 'GateRecord $def must exist')
  assert.ok(!gr.required.includes('delivery'), 'delivery must not be in GateRecord.required')

  const dp = gr.properties.delivery
  assert.ok(dp, 'GateRecord.properties.delivery must exist')
  assert.equal(dp.type, 'object')
  assert.equal(dp.additionalProperties, false)
  assert.deepEqual(new Set(dp.required), new Set(['attempted', 'ok', 'channel', 'at']))
  assert.equal(dp.properties.attempted.type, 'boolean')
  assert.equal(dp.properties.ok.type, 'boolean')
  assert.equal(dp.properties.channel.type, 'string')
  assert.equal(dp.properties.at.type, 'string')
  assert.equal(dp.properties.at.format, 'date-time')
  assert.ok(dp.properties.error, 'an optional error property must be describable')
  assert.equal(dp.properties.error.type, 'string')
  assert.ok(!dp.required.includes('error'), 'error must be optional within delivery')
})

test('AC-1: every existing gates/closed/*.json record still validates as GateRecord', async () => {
  const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
  const closedDir = path.join(REPO, 'gates', 'closed')
  const files = fs.readdirSync(closedDir).filter(f => f.endsWith('.json'))
  assert.ok(files.length > 0, 'expected pre-existing closed gate records to validate against')
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(closedDir, f), 'utf8'))
    const { ok, errors } = validate('GateRecord', rec)
    assert.ok(ok, `${f} should still validate after the delivery field is added: ${JSON.stringify(errors)}`)
  }
})
