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

test('POST /items rejects a 65-character name with 400 "name too long"', async () => {
  const { base, close } = await start()
  try {
    const name = 'a'.repeat(65)
    const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'name too long' })
    const list = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(list, [])
  } finally { await close() }
})

test('POST /items accepts a name of exactly 64 characters', async () => {
  const { base, close } = await start()
  try {
    const name = 'a'.repeat(64)
    const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    assert.equal(res.status, 201)
    const item = await res.json()
    assert.equal(typeof item.id, 'number')
    assert.equal(item.name, name)
    const list = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(list, [item])
  } finally { await close() }
})

test('POST /items accepts a name of exactly 63 characters', async () => {
  const { base, close } = await start()
  try {
    const name = 'a'.repeat(63)
    const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    assert.equal(res.status, 201)
    const item = await res.json()
    assert.equal(item.name, name)
  } finally { await close() }
})

test('POST /items still rejects empty string and non-string names as "name is required", not "name too long"', async () => {
  const { base, close } = await start()
  try {
    const emptyRes = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) })
    assert.equal(emptyRes.status, 400)
    assert.deepEqual(await emptyRes.json(), { error: 'name is required' })

    const nonStringRes = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 123 }) })
    assert.equal(nonStringRes.status, 400)
    assert.deepEqual(await nonStringRes.json(), { error: 'name is required' })
  } finally { await close() }
})

test('POST /items rejecting an over-length name does not consume an id or mutate state', async () => {
  const { base, close } = await start()
  try {
    const overLong = 'a'.repeat(200)
    const rejected = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: overLong }) })
    assert.equal(rejected.status, 400)
    assert.deepEqual(await rejected.json(), { error: 'name too long' })

    const accepted = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })
    assert.equal(accepted.status, 201)
    const item = await accepted.json()
    assert.equal(item.id, 1)
    assert.equal(item.name, 'widget')
  } finally { await close() }
})

test('GET /items/:id returns the created item', async () => {
  const { base, close } = await start()
  try {
    const created = await (await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })).json()
    const res = await fetch(`${base}/items/${created.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.deepEqual(await res.json(), created)
  } finally { await close() }
})

test('GET /items/:id returns each of several created items with no cross-contamination', async () => {
  const { base, close } = await start()
  try {
    const post = (name) => fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then(r => r.json())
    const a = await post('a')
    const b = await post('b')
    const c = await post('c')
    assert.deepEqual(await (await fetch(`${base}/items/${a.id}`)).json(), a)
    assert.deepEqual(await (await fetch(`${base}/items/${b.id}`)).json(), b)
    assert.deepEqual(await (await fetch(`${base}/items/${c.id}`)).json(), c)
  } finally { await close() }
})

test('GET /items/:id returns 404 for a well-formed id with no item', async () => {
  const { base, close } = await start()
  try {
    const res = await fetch(`${base}/items/1`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not found' })
  } finally { await close() }
})

test('GET /items/:id returns 404 for a missing id among existing items', async () => {
  const { base, close } = await start()
  try {
    await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })
    const res = await fetch(`${base}/items/999`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not found' })
  } finally { await close() }
})

test('GET /items/:id returns 404 for a non-numeric id', async () => {
  const { base, close } = await start()
  try {
    await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })
    const res = await fetch(`${base}/items/abc`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not found' })
  } finally { await close() }
})

test('GET /items/:id returns 404 for non-canonical integer formats', async () => {
  const { base, close } = await start()
  try {
    await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })
    for (const bad of ['1.5', '-1', '1e0', '%201', '0x1']) {
      const res = await fetch(`${base}/items/${bad}`)
      assert.equal(res.status, 404, `expected 404 for ${bad}`)
      assert.deepEqual(await res.json(), { error: 'not found' })
    }
  } finally { await close() }
})

test('GET /items/:id store is isolated per app instance', async () => {
  const first = await start()
  const second = await start()
  try {
    await fetch(`${first.base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })
    const res = await fetch(`${second.base}/items/1`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not found' })
  } finally {
    await first.close()
    await second.close()
  }
})

test('GET /items collection route is unaffected by the :id route', async () => {
  const { base, close } = await start()
  try {
    const before = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(before, [])
    const item = await (await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'widget' }) })).json()
    const after = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(after, [item])
  } finally { await close() }
})
