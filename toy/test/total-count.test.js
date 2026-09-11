// Tests for spec-wi-imp-1 / task impl-add-x-total-count-header: the
// X-Total-Count response header on GET /items.
//
// Written to the repo's existing test convention (node:test + fetch; see
// toy/test/items.test.js, toy/test/q-filter.test.js and
// toy/test/integration-r5.test.js) so this file can be dropped into
// toy/test/ and picked up by the repo's existing runner unchanged: `npm
// test` (NODE_ENV=test node --test "test/*.test.js") from toy/. It imports
// the shared `start()` helper from ./helpers.js exactly like the other
// suites in toy/test/.
//
// Written from the spec ONLY (.artifacts/build/t3/specs/spec-wi-imp-1.json).
// No implementation source of this task was read to write these tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { start } from './helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')

const post = (base, body) =>
  fetch(`${base}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

const created = async (base, body) => {
  const res = await post(base, body)
  assert.equal(res.status, 201)
  return res.json()
}

// Creates items in insertion order and returns their created bodies.
async function seed(base, names) {
  const out = []
  for (const name of names) out.push(await created(base, { name }))
  return out
}

const namesOf = (list) => list.map(i => i.name)

// Counts how many times a header name (case-insensitive) appears as a
// distinct entry in the Headers iterator, so "exactly once" can be checked
// rather than relying solely on Headers.get(), which folds repeats into a
// single comma-joined string.
function countHeaderEntries(headers, name) {
  const lower = name.toLowerCase()
  let count = 0
  for (const [k] of headers.entries()) {
    if (k.toLowerCase() === lower) count++
  }
  return count
}

test('AC-1: an uncapped GET /items response is 200 with a bare 3-element array and X-Total-Count "3"', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['a', 'b', 'c'])
    const res = await fetch(`${base}/items`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, seeded)
    assert.equal(body.length, 3)
    assert.equal(res.headers.get('x-total-count'), '3')
  } finally { await close() }
})

test('AC-2: GET /items?limit=2 over 5 items returns a 2-element page but X-Total-Count "5" (the pre-cap count)', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['i1', 'i2', 'i3', 'i4', 'i5'])
    const res = await fetch(`${base}/items?limit=2`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, seeded.slice(0, 2))
    assert.equal(body.length, 2)
    assert.equal(res.headers.get('x-total-count'), '5')
  } finally { await close() }
})

test('AC-3: when limit equals or exceeds the match count, X-Total-Count equals the returned array length, signalling a complete answer', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['x', 'y'])

    const equalLimit = await fetch(`${base}/items?limit=2`)
    assert.equal(equalLimit.status, 200)
    const equalBody = await equalLimit.json()
    assert.equal(equalBody.length, 2)
    assert.equal(equalLimit.headers.get('x-total-count'), '2')
    assert.equal(Number(equalLimit.headers.get('x-total-count')), equalBody.length)

    const largerLimit = await fetch(`${base}/items?limit=10`)
    assert.equal(largerLimit.status, 200)
    const largerBody = await largerLimit.json()
    assert.equal(largerBody.length, 2)
    assert.equal(largerLimit.headers.get('x-total-count'), '2')
    assert.equal(Number(largerLimit.headers.get('x-total-count')), largerBody.length)
  } finally { await close() }
})

test('AC-4: X-Total-Count counts after the ?q filter and before the ?limit cap', async () => {
  const { base, close } = await start()
  try {
    // seeded in order; 'banana' and 'mango' contain 'an', 'apple' and 'cherry' do not
    await seed(base, ['banana', 'apple', 'cherry', 'mango'])
    const res = await fetch(`${base}/items?q=an&limit=1`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(namesOf(body), ['banana'])
    // not "4" (unfiltered) and not "1" (post-cap) — the post-filter, pre-cap count
    assert.equal(res.headers.get('x-total-count'), '2')
  } finally { await close() }
})

test('AC-5: sorting never changes the header value, only the order of the returned array', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['banana', 'apple', 'cherry', 'mango'])

    const plain = await fetch(`${base}/items?limit=2`)
    assert.equal(plain.status, 200)
    assert.equal(plain.headers.get('x-total-count'), '4')

    const byNameCapped = await fetch(`${base}/items?sort=name&limit=2`)
    assert.equal(byNameCapped.status, 200)
    assert.equal(byNameCapped.headers.get('x-total-count'), '4')

    const byIdCapped = await fetch(`${base}/items?sort=id&limit=2`)
    assert.equal(byIdCapped.status, 200)
    assert.equal(byIdCapped.headers.get('x-total-count'), '4')

    const byNameUncapped = await fetch(`${base}/items?sort=name`)
    assert.equal(byNameUncapped.status, 200)
    assert.equal(byNameUncapped.headers.get('x-total-count'), '4')
    assert.deepEqual(namesOf(await byNameUncapped.json()), ['apple', 'banana', 'cherry', 'mango'])
  } finally { await close() }
})

test('AC-6: zero matches is reported as X-Total-Count "0" (present, not omitted), for an empty store and for a non-matching ?q', async () => {
  const { base, close } = await start()
  try {
    const emptyStoreRes = await fetch(`${base}/items`)
    assert.equal(emptyStoreRes.status, 200)
    assert.deepEqual(await emptyStoreRes.json(), [])
    assert.equal(emptyStoreRes.headers.get('x-total-count'), '0')
    assert.notEqual(emptyStoreRes.headers.get('x-total-count'), null)
  } finally { await close() }
})

test('AC-6b: zero matches from a populated store via a non-matching ?q is also X-Total-Count "0"', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['banana', 'apple', 'cherry'])
    const res = await fetch(`${base}/items?q=zzz&limit=5`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
    assert.equal(res.headers.get('x-total-count'), '0')
  } finally { await close() }
})

test('AC-7: X-Total-Count is a canonical decimal integer string, present exactly once, case-insensitively named', async () => {
  const { base, close } = await start()
  try {
    await seed(base, Array.from({ length: 12 }, (_, i) => `item-${i}`))
    const res = await fetch(`${base}/items?limit=3`)
    assert.equal(res.status, 200)

    assert.equal(res.headers.get('x-total-count'), '12')
    assert.equal(res.headers.get('X-Total-Count'), '12')
    assert.equal(res.headers.get('X-TOTAL-COUNT'), '12')

    // exactly one header entry, not a repeated/comma-joined value
    assert.equal(countHeaderEntries(res.headers, 'x-total-count'), 1)
    assert.ok(!res.headers.get('x-total-count').includes(','))

    const value = res.headers.get('x-total-count')
    assert.match(value, /^(0|[1-9][0-9]*)$/)
    assert.equal(value, '12')
  } finally { await close() }
})

test('AC-8: 400 responses from every existing validator keep their exact JSON error body, precedence and never carry X-Total-Count', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['a', 'b', 'c'])

    const bracketedQ = await fetch(`${base}/items?q[x]=y`)
    assert.equal(bracketedQ.status, 400)
    assert.deepEqual(await bracketedQ.json(), { error: 'invalid q' })
    assert.equal(bracketedQ.headers.get('x-total-count'), null)

    const repeatedQ = await fetch(`${base}/items?q=a&q=b`)
    assert.equal(repeatedQ.status, 400)
    assert.deepEqual(await repeatedQ.json(), { error: 'invalid q' })
    assert.equal(repeatedQ.headers.get('x-total-count'), null)

    const badSort = await fetch(`${base}/items?sort=bogus`)
    assert.equal(badSort.status, 400)
    assert.deepEqual(await badSort.json(), { error: 'invalid sort' })
    assert.equal(badSort.headers.get('x-total-count'), null)

    const badLimit = await fetch(`${base}/items?limit=0`)
    assert.equal(badLimit.status, 400)
    assert.deepEqual(await badLimit.json(), { error: 'invalid limit' })
    assert.equal(badLimit.headers.get('x-total-count'), null)

    const repeatedLimit = await fetch(`${base}/items?limit=1&limit=2`)
    assert.equal(repeatedLimit.status, 400)
    assert.deepEqual(await repeatedLimit.json(), { error: 'invalid limit' })
    assert.equal(repeatedLimit.headers.get('x-total-count'), null)

    const bothBad = await fetch(`${base}/items?sort=bogus&limit=0`)
    assert.equal(bothBad.status, 400)
    // q -> sort -> limit precedence is unchanged: sort's error wins over limit's
    assert.deepEqual(await bothBad.json(), { error: 'invalid sort' })
    assert.equal(bothBad.headers.get('x-total-count'), null)
  } finally { await close() }
})

test('AC-9: the response body stays a bare JSON array of unmodified Item objects, with the pre-existing content-type', async () => {
  const { base, close } = await start()
  try {
    await seed(base, ['a', 'b', 'c'])
    const res = await fetch(`${base}/items?sort=name&limit=2`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8')
    const body = await res.json()
    assert.equal(Array.isArray(body), true)
    for (const item of body) {
      assert.deepEqual(Object.keys(item).sort(), ['created_at', 'id', 'name', 'tags'])
    }
  } finally { await close() }
})

test('AC-10: the change is purely additive — a broad cross-section of existing GET /items behaviors is unaffected alongside the new header', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['banana', 'apple', 'cherry', 'mango'])

    // filter -> sort -> cap pipeline still produces its pre-existing results
    const filtered = await fetch(`${base}/items?q=an&sort=name&limit=1`)
    assert.equal(filtered.status, 200)
    assert.deepEqual(namesOf(await filtered.json()), ['banana'])

    const sortOnly = await fetch(`${base}/items?sort=name`)
    assert.equal(sortOnly.status, 200)
    assert.deepEqual(namesOf(await sortOnly.json()), ['apple', 'banana', 'cherry', 'mango'])

    // unrelated routes are untouched
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)

    const byId = await fetch(`${base}/items/${seeded[0].id}`)
    assert.equal(byId.status, 200)
    assert.deepEqual(await byId.json(), seeded[0])

    const missing = await fetch(`${base}/items/999999`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'not found' })

    const notFound = await fetch(`${base}/does-not-exist`)
    assert.equal(notFound.status, 404)
    assert.deepEqual(await notFound.json(), { error: 'not found' })

    // the store itself is unaffected by any of the above
    const finalList = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(finalList, seeded)
  } finally { await close() }
})

test('AC-11: X-Total-Count never appears on GET /health, GET /items/:id, POST /items, DELETE /items/:id or the 404 catch-all', async () => {
  const previousToken = process.env.ADMIN_TOKEN
  process.env.ADMIN_TOKEN = 'test-admin-token-total-count'
  const { base, close } = await start()
  try {
    const item = await created(base, { name: 'widget' })

    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('x-total-count'), null)

    const byId = await fetch(`${base}/items/${item.id}`)
    assert.equal(byId.status, 200)
    assert.deepEqual(await byId.json(), item)
    assert.equal(byId.headers.get('x-total-count'), null)

    const byIdWithLimit = await fetch(`${base}/items/${item.id}?limit=0`)
    assert.equal(byIdWithLimit.status, 200)
    assert.deepEqual(await byIdWithLimit.json(), item)
    assert.equal(byIdWithLimit.headers.get('x-total-count'), null)

    const postOk = await post(base, { name: 'widget2' })
    assert.equal(postOk.status, 201)
    assert.equal(postOk.headers.get('x-total-count'), null)

    const deleteOk = await fetch(`${base}/items/${item.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}` }
    })
    assert.equal(deleteOk.status, 204)
    assert.equal(deleteOk.headers.get('x-total-count'), null)

    const notFound = await fetch(`${base}/nope`)
    assert.equal(notFound.status, 404)
    assert.deepEqual(await notFound.json(), { error: 'not found' })
    assert.equal(notFound.headers.get('x-total-count'), null)
  } finally {
    await close()
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN
    else process.env.ADMIN_TOKEN = previousToken
  }
})

test('AC-12: computing the count is read-only — repeated identical requests agree and the store keeps its insertion order and ids', async () => {
  const { base, close } = await start()
  try {
    const seeded = await seed(base, ['banana', 'apple', 'cherry', 'mango'])

    const first = await fetch(`${base}/items?q=an&limit=1`)
    const firstBody = await first.json()
    const firstCount = first.headers.get('x-total-count')

    const second = await fetch(`${base}/items?q=an&limit=1`)
    const secondBody = await second.json()
    const secondCount = second.headers.get('x-total-count')

    const third = await fetch(`${base}/items?q=an&limit=1`)
    const thirdBody = await third.json()
    const thirdCount = third.headers.get('x-total-count')

    assert.deepEqual(firstBody, secondBody)
    assert.deepEqual(secondBody, thirdBody)
    assert.equal(firstCount, secondCount)
    assert.equal(secondCount, thirdCount)

    const finalList = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(finalList, seeded)
    assert.deepEqual(finalList.map(i => i.id), seeded.map(i => i.id))
  } finally { await close() }
})

// True if both regexes match somewhere in `text`, within `window` characters
// of each other, in either order. Used to check that two concepts are
// documented together without pinning down exact wording or word order.
function near(text, a, b, window) {
  return new RegExp(`${a}[\\s\\S]{0,${window}}${b}`, 'i').test(text) ||
    new RegExp(`${b}[\\s\\S]{0,${window}}${a}`, 'i').test(text)
}

test('AC-13: README documents X-Total-Count in the GET /items section: name, what it counts, when present/absent, and how to detect truncation', () => {
  // Anchor on the GET /items section, which documents the filter -> sort ->
  // cap pipeline and its query parameters.
  const itemsSectionMatch = README.match(/GET \/items[^\n]*\n([\s\S]*?)(?:\n##|$)/)
  assert.ok(itemsSectionMatch, 'expected README.md to contain a GET /items section')
  const section = itemsSectionMatch[1]

  // Names the header exactly.
  assert.match(section, /X-Total-Count/, 'README GET /items section must name the X-Total-Count header')

  // Present on every successful (200) response, including uncapped and zero-match ones.
  assert.ok(
    /\bevery\b/i.test(section) && /\b200\b|success/i.test(section),
    'README must state X-Total-Count is present on every successful (200) GET /items response'
  )
  assert.match(section, /uncapped/i, 'README must state the header is present on uncapped responses')
  assert.match(
    section,
    /\bempty\b|zero.{0,15}match/i,
    'README must state the header is present on empty/zero-match responses'
  )

  // Value is the count after ?q filter and before ?limit cap.
  assert.ok(near(section, 'after', 'filter', 80), 'README must state the count is taken after the ?q filter')
  assert.ok(near(section, 'before', '(limit|cap)', 80), 'README must state the count is taken before the ?limit cap')

  // Absent on 400 responses.
  assert.ok(
    near(section, '400', '(absent|omit|not present|no\\b.{0,20}X-Total-Count|without)', 100),
    'README must state X-Total-Count is absent on 400 responses'
  )

  // Explains how a client distinguishes complete vs truncated: compare the
  // header to the returned array length, not the limit requested.
  assert.match(section, /compar/i, 'README must describe comparing X-Total-Count to the returned array length')
  assert.match(
    section,
    /truncat|complete/i,
    'README must describe distinguishing a complete answer from a truncated one'
  )
})
