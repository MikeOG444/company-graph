import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './helpers.js'

test('GET /items starts empty', async () => {
  const { base, close } = await start()
  try {
    const res = await fetch(`${base}/items`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  } finally { await close() }
})

test('POST /items creates an item and GET /items lists it', async () => {
  const { base, close } = await start()
  try {
    const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })
    assert.equal(res.status, 201)
    const item = await res.json()
    assert.equal(item.name, 'widget')
    assert.equal(typeof item.id, 'number')
    const list = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(list, [item])
  } finally { await close() }
})

test('POST /items rejects a missing name with 400', async () => {
  const { base, close } = await start()
  try {
    const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'name is required' })
  } finally { await close() }
})
