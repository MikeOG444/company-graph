// Regression tests for the GET /items ?q filter (spec-wi-patch-sig-p4-merged).
//
// This file is written to the repo's existing test convention (node:test + fetch,
// see toy/test/items.test.js) so it can be dropped into toy/test/ and picked up by
// the repo's existing runner unchanged: `npm test` (NODE_ENV=test node --test
// "test/*.test.js") from toy/. It imports the shared `start()` helper from
// ./helpers.js exactly like the other suites in toy/test/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './helpers.js'

// Creates items in order and returns their created bodies.
async function seed(base, names) {
  const out = []
  for (const name of names) {
    const res = await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    out.push(await res.json())
  }
  return out
}

const namesOf = (list) => list.map(i => i.name)

test('AC-1: GET /items?q=an returns a case-insensitive substring match, in insertion order, never a 500', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['banana', 'apple', 'cherry', 'mango'])
    const res = await fetch(`${base}/items?q=an`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') || '', /application\/json/)
    const body = await res.json()
    assert.deepEqual(namesOf(body), ['banana', 'mango'])
  } finally { await close() }
})

test('AC-2: GET /items?q=an&limit=2 caps the FILTERED list, not the full insertion-ordered list', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['banana', 'apple', 'cherry', 'mango'])
    const res = await fetch(`${base}/items?q=an&limit=2`)
    assert.equal(res.status, 200)
    assert.deepEqual(namesOf(await res.json()), ['banana', 'mango'])
  } finally { await close() }
})

test('AC-3: GET /items?q=an&sort=name&limit=1 runs filter -> sort -> cap in that order', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['banana', 'apple', 'cherry', 'mango'])
    const res = await fetch(`${base}/items?q=an&sort=name&limit=1`)
    assert.equal(res.status, 200)
    assert.deepEqual(namesOf(await res.json()), ['banana'])
  } finally { await close() }
})

test('AC-4: q and name are both lower-cased with toLowerCase() before matching', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['Banana', 'apple'])
    for (const q of ['BAN', 'ban', 'Ban']) {
      const res = await fetch(`${base}/items?q=${q}`)
      assert.equal(res.status, 200, `expected 200 for q=${q}`)
      assert.deepEqual(namesOf(await res.json()), ['Banana'], `expected ['Banana'] for q=${q}`)
    }
  } finally { await close() }
})

test('AC-5: the needle is a literal substring — no regex, no trimming', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['abc', 'banana'])

    const regexAttempt = await fetch(`${base}/items?q=a.c`)
    assert.equal(regexAttempt.status, 200)
    assert.deepEqual(await regexAttempt.json(), [])

    const untrimmed = await fetch(`${base}/items?q=${encodeURIComponent(' an')}`)
    assert.equal(untrimmed.status, 200)
    assert.deepEqual(await untrimmed.json(), [])

    const contiguous = await fetch(`${base}/items?q=nan`)
    assert.equal(contiguous.status, 200)
    assert.deepEqual(namesOf(await contiguous.json()), ['banana'])
  } finally { await close() }
})

test('AC-6: a q with no matches returns 200 with an empty array, not 404 or 500', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['banana', 'apple', 'cherry', 'mango'])
    const res = await fetch(`${base}/items?q=zzz`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  } finally { await close() }
})

test('AC-7: an empty or absent q matches everything and short-circuits the filter', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['banana', 'apple', 'cherry', 'mango'])

    const emptyQ = await fetch(`${base}/items?q=`)
    assert.equal(emptyQ.status, 200)
    assert.deepEqual(await emptyQ.json(), seeded)

    const noQ = await fetch(`${base}/items`)
    assert.equal(noQ.status, 200)
    assert.deepEqual(await noQ.json(), seeded)

    const emptyQWithSortLimit = await fetch(`${base}/items?q=&sort=name&limit=2`)
    assert.equal(emptyQWithSortLimit.status, 200)
    assert.deepEqual(namesOf(await emptyQWithSortLimit.json()), ['apple', 'banana'])
  } finally { await close() }
})

test('AC-8: repeated or bracketed q is rejected with 400 {"error":"invalid q"} and never mutates the store', async () => {
  const { base, close } = await start()
  try {
    const created = await (await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'banana' }) })).json()

    const repeated = await fetch(`${base}/items?q=a&q=b`)
    assert.equal(repeated.status, 400)
    assert.deepEqual(await repeated.json(), { error: 'invalid q' })

    const bracketed = await fetch(`${base}/items?q[x]=y`)
    assert.equal(bracketed.status, 400)
    assert.deepEqual(await bracketed.json(), { error: 'invalid q' })

    const list = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(list, [created])
  } finally { await close() }
})

test('AC-9: validation precedence (q, then sort, then limit) is unchanged and every rejection is JSON', async () => {
  const { base, close } = await start()
  try {
    await fetch(`${base}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'banana' }) })

    const qFirst = await fetch(`${base}/items?q[x]=y&sort=bogus&limit=0`)
    assert.equal(qFirst.status, 400)
    assert.deepEqual(await qFirst.json(), { error: 'invalid q' })

    const sortSecond = await fetch(`${base}/items?q=an&sort=bogus`)
    assert.equal(sortSecond.status, 400)
    assert.deepEqual(await sortSecond.json(), { error: 'invalid sort' })

    const limitThird = await fetch(`${base}/items?q=an&sort=name&limit=0`)
    assert.equal(limitThird.status, 400)
    assert.deepEqual(await limitThird.json(), { error: 'invalid limit' })
  } finally { await close() }
})

test('AC-10: the filter is read-only — repeated identical q calls agree and the store keeps its full insertion order and ids', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['banana', 'apple', 'cherry', 'mango'])

    const first = await (await fetch(`${base}/items?q=an`)).json()
    const second = await (await fetch(`${base}/items?q=an`)).json()
    assert.deepEqual(namesOf(first), ['banana', 'mango'])
    assert.deepEqual(first, second)

    const unfiltered = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(unfiltered, seeded)
  } finally { await close() }
})

test('AC-11: the q-filter fix does not disturb the other GET /items routes or unrelated endpoints', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['banana', 'apple', 'cherry', 'mango'])

    // Exercise the fixed q pipeline first.
    const filtered = await (await fetch(`${base}/items?q=an&sort=name&limit=1`)).json()
    assert.deepEqual(namesOf(filtered), ['banana'])

    // Unrelated / previously-existing routes still behave exactly as before.
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)

    const byId = await fetch(`${base}/items/${seeded[0].id}`)
    assert.equal(byId.status, 200)
    assert.deepEqual(await byId.json(), seeded[0])

    const missing = await fetch(`${base}/items/999999`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'not found' })

    const sortOnly = await fetch(`${base}/items?sort=name`)
    assert.equal(sortOnly.status, 200)
    assert.deepEqual(namesOf(await sortOnly.json()), ['apple', 'banana', 'cherry', 'mango'])

    const notFound = await fetch(`${base}/does-not-exist`)
    assert.equal(notFound.status, 404)
    assert.deepEqual(await notFound.json(), { error: 'not found' })

    // The store itself is unaffected by any of the above.
    const finalList = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(finalList, seeded)
  } finally { await close() }
})
