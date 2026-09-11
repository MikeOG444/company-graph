// Integration coverage for the r5 merge: wi-5 (?limit), wi-7 (/health version),
// wi-8 (JSON 404 catch-all), wi-9 (request logger), wi-10 (?sort),
// wi-11 (created_at) and wi-12 (tags) now coexist in one app.js. The per-branch
// suites were written against a baseline where the other six did not exist, so
// these tests pin the *combined* contract — especially the places where two
// branches touch the same handler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './helpers.js'

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

const ITEM_KEYS = ['created_at', 'id', 'name', 'tags']

// --- merged Item shape: wi-11 created_at + wi-12 tags on one object ---------

test('merged Item shape carries id, name, tags and created_at on every representation', async () => {
  const { base, close } = await start()
  try {
    const before = Date.now()
    const item = await created(base, { name: 'widget', tags: ['x', 'y'] })
    const after = Date.now()

    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS)
    assert.equal(item.id, 1)
    assert.equal(item.name, 'widget')
    assert.deepEqual(item.tags, ['x', 'y'])
    assert.match(item.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal(new Date(item.created_at).toISOString(), item.created_at)
    assert.ok(before <= Date.parse(item.created_at) && Date.parse(item.created_at) <= after)

    // same shape and same frozen values through both GET routes
    const one = await (await fetch(`${base}/items/${item.id}`)).json()
    assert.deepEqual(one, item)
    const list = await (await fetch(`${base}/items`)).json()
    assert.deepEqual(list, [item])
  } finally { await close() }
})

test('tags defaults to [] and created_at is assigned even when the POST body omits both', async () => {
  const { base, close } = await start()
  try {
    const item = await created(base, { name: 'plain' })
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS)
    assert.deepEqual(item.tags, [])
    assert.ok(Number.isFinite(Date.parse(item.created_at)))
  } finally { await close() }
})

test('client-supplied id/created_at are ignored; invalid tags are rejected and consume no id', async () => {
  const { base, close } = await start()
  try {
    const spoofed = await created(base, { name: 'spoof', id: 99, created_at: '1999-01-01T00:00:00.000Z' })
    assert.equal(spoofed.id, 1)
    assert.notEqual(spoofed.created_at, '1999-01-01T00:00:00.000Z')
    assert.deepEqual(Object.keys(spoofed).sort(), ITEM_KEYS)

    for (const tags of ['a', 5, null, {}, [''], ['a'.repeat(33)], [1], Array(11).fill('t')]) {
      const res = await post(base, { name: 'nope', tags })
      assert.equal(res.status, 400, `expected 400 for tags=${JSON.stringify(tags)}`)
      assert.deepEqual(await res.json(), { error: 'invalid tags' })
    }

    // wi-12 ac-10 / ac-11: nothing stored, no ids burned, name validation still wins
    const next = await created(base, { name: 'second' })
    assert.equal(next.id, 2)

    const noName = await post(base, { tags: 'not-an-array' })
    assert.equal(noName.status, 400)
    assert.deepEqual(await noName.json(), { error: 'name is required' })
    const tooLong = await post(base, { name: 'a'.repeat(65), tags: 'not-an-array' })
    assert.equal(tooLong.status, 400)
    assert.deepEqual(await tooLong.json(), { error: 'name too long' })
  } finally { await close() }
})

test('boundary tags are accepted verbatim: 1 and 32 code units, 10 entries, duplicates, whitespace', async () => {
  const { base, close } = await start()
  try {
    const item = await created(base, { name: 'edge', tags: ['a', 'b'.repeat(32), 'dup', 'dup', ' '] })
    assert.deepEqual(item.tags, ['a', 'b'.repeat(32), 'dup', 'dup', ' '])
    const ten = await created(base, { name: 'ten', tags: Array(10).fill('t') })
    assert.equal(ten.tags.length, 10)
    const emptyArray = await created(base, { name: 'empty', tags: [] })
    assert.deepEqual(emptyArray.tags, [])
  } finally { await close() }
})

// --- wi-5 ?limit and wi-10 ?sort on the same handler ------------------------

test('GET /items?limit=N caps in insertion order and validates canonically', async () => {
  const { base, close } = await start()
  try {
    const a = await created(base, { name: 'a' })
    const b = await created(base, { name: 'b' })
    const c = await created(base, { name: 'c' })

    assert.deepEqual(await (await fetch(`${base}/items`)).json(), [a, b, c])
    assert.deepEqual(await (await fetch(`${base}/items?limit=2`)).json(), [a, b])
    assert.deepEqual(await (await fetch(`${base}/items?limit=1`)).json(), [a])
    assert.deepEqual(await (await fetch(`${base}/items?limit=3`)).json(), [a, b, c])
    assert.deepEqual(await (await fetch(`${base}/items?limit=10`)).json(), [a, b, c])

    for (const bad of ['0', '-1', '-5', 'abc', '1.5', '1e1', '0x1', '%2B1', '01', '%201', '1%20', 'true', '', '99999999999999999999']) {
      const res = await fetch(`${base}/items?limit=${bad}`)
      assert.equal(res.status, 400, `expected 400 for limit=${bad}`)
      assert.deepEqual(await res.json(), { error: 'invalid limit' })
    }
    const repeated = await fetch(`${base}/items?limit=1&limit=2`)
    assert.equal(repeated.status, 400)
    assert.deepEqual(await repeated.json(), { error: 'invalid limit' })

    // unknown params ignored; rejected limit mutated nothing
    assert.deepEqual(await (await fetch(`${base}/items?limit=1&offset=1&foo=bar`)).json(), [a])
    assert.deepEqual(await (await fetch(`${base}/items`)).json(), [a, b, c])
    const d = await created(base, { name: 'd' })
    assert.equal(d.id, 4)
  } finally { await close() }
})

test('limit is ignored, not validated, on GET /items/:id', async () => {
  const { base, close } = await start()
  try {
    const item = await created(base, { name: 'widget' })
    const hit = await fetch(`${base}/items/${item.id}?limit=0`)
    assert.equal(hit.status, 200)
    assert.deepEqual(await hit.json(), item)
    const miss = await fetch(`${base}/items/999?limit=abc`)
    assert.equal(miss.status, 404)
    assert.deepEqual(await miss.json(), { error: 'not found' })
  } finally { await close() }
})

test('GET /items?sort=name orders by code unit; ?sort=id keeps insertion order', async () => {
  const { base, close } = await start()
  try {
    const zebra = await created(base, { name: 'Zebra' })
    const apple = await created(base, { name: 'apple' })
    const upperApple = await created(base, { name: 'Apple' })
    const banana = await created(base, { name: 'banana' })

    const byName = await fetch(`${base}/items?sort=name`)
    assert.equal(byName.status, 200)
    assert.match(byName.headers.get('content-type') || '', /application\/json/)
    // plain `<` comparison: all uppercase ASCII before all lowercase
    assert.deepEqual(await byName.json(), [upperApple, zebra, apple, banana])

    assert.deepEqual(await (await fetch(`${base}/items?sort=id`)).json(), [zebra, apple, upperApple, banana])
    assert.deepEqual(await (await fetch(`${base}/items`)).json(), [zebra, apple, upperApple, banana])
  } finally { await close() }
})

test('sort=name is stable for equal names and never mutates stored order', async () => {
  const { base, close } = await start()
  try {
    const one = await created(base, { name: 'dup' })
    const two = await created(base, { name: 'dup' })
    const three = await created(base, { name: 'dup' })
    assert.deepEqual(await (await fetch(`${base}/items?sort=name`)).json(), [one, two, three])
    assert.deepEqual(await (await fetch(`${base}/items`)).json(), [one, two, three])
  } finally { await close() }
})

test('GET /items rejects any other sort value with 400 invalid sort', async () => {
  const { base, close } = await start()
  try {
    await created(base, { name: 'widget' })
    for (const bad of ['created', '', 'Name', 'NAME', 'ID', '%20name', 'name%20', 'bogus']) {
      const res = await fetch(`${base}/items?sort=${bad}`)
      assert.equal(res.status, 400, `expected 400 for sort=${bad}`)
      assert.match(res.headers.get('content-type') || '', /application\/json/)
      assert.deepEqual(await res.json(), { error: 'invalid sort' })
    }
    const repeated = await fetch(`${base}/items?sort=name&sort=id`)
    assert.equal(repeated.status, 400)
    assert.deepEqual(await repeated.json(), { error: 'invalid sort' })
  } finally { await close() }
})

test('merged pipeline is filter -> sort -> cap: limit applies after sorting, not before', async () => {
  const { base, close } = await start()
  try {
    const banana = await created(base, { name: 'banana' })
    await created(base, { name: 'apple' })
    await created(base, { name: 'cherry' })
    const mango = await created(base, { name: 'mango' })

    // insertion order is banana, apple, cherry, mango — a cap-before-sort
    // implementation would return [apple, banana] here.
    const capped = await fetch(`${base}/items?sort=name&limit=2`)
    assert.equal(capped.status, 200)
    const names = (await capped.json()).map(i => i.name)
    assert.deepEqual(names, ['apple', 'banana'])

    // one item, chosen by name order rather than insertion order
    assert.deepEqual(await (await fetch(`${base}/items?sort=name&limit=1`)).json(), [(await (await fetch(`${base}/items?sort=name`)).json())[0]])
    // sort=id + limit still means insertion order
    assert.deepEqual((await (await fetch(`${base}/items?sort=id&limit=1`)).json()).map(i => i.name), ['banana'])
    assert.equal(banana.id, 1)
    assert.equal(mango.id, 4)
  } finally { await close() }
})

test('both parameters valid or invalid together still yields a single deterministic 400', async () => {
  const { base, close } = await start()
  try {
    await created(base, { name: 'a' })
    const bothBad = await fetch(`${base}/items?sort=bogus&limit=0`)
    assert.equal(bothBad.status, 400)
    // sort is validated first; the body is one of the two documented errors and
    // never a 500 or a partial list.
    assert.deepEqual(await bothBad.json(), { error: 'invalid sort' })

    const sortOkLimitBad = await fetch(`${base}/items?sort=name&limit=0`)
    assert.equal(sortOkLimitBad.status, 400)
    assert.deepEqual(await sortOkLimitBad.json(), { error: 'invalid limit' })

    // a rejected combined request mutates nothing
    assert.equal((await (await fetch(`${base}/items`)).json()).length, 1)
  } finally { await close() }
})

// --- wi-8 JSON 404 catch-all alongside everything else ----------------------

test('unmatched routes and method mismatches return the JSON 404, not Express HTML', async () => {
  const { base, close } = await start()
  try {
    const item = await created(base, { name: 'widget' })
    for (const [method, path] of [['GET', '/nope'], ['GET', '/'], ['POST', '/health'], ['DELETE', '/nope'], ['PUT', '/items'], ['PATCH', '/items/1']]) {
      const res = await fetch(`${base}${path}`, { method })
      assert.equal(res.status, 404, `${method} ${path}`)
      assert.match(res.headers.get('content-type') || '', /application\/json/)
      assert.deepEqual(await res.json(), { error: 'not found' }, `${method} ${path}`)
    }

    const head = await fetch(`${base}/nope`, { method: 'HEAD' })
    assert.equal(head.status, 404)
    assert.match(head.headers.get('content-type') || '', /application\/json/)

    // the catch-all deleted nothing and intercepted no real route
    assert.deepEqual(await (await fetch(`${base}/items/${item.id}`)).json(), item)
    assert.deepEqual(await (await fetch(`${base}/items`)).json(), [item])
  } finally { await close() }
})

test('the catch-all does not swallow express.json() parse failures or route-level 400s', async () => {
  const { base, close } = await start()
  try {
    const malformed = await fetch(`${base}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json'
    })
    assert.ok(malformed.status >= 400 && malformed.status < 500)
    assert.notEqual(malformed.status, 404)

    const missingName = await post(base, {})
    assert.equal(missingName.status, 400)
    assert.deepEqual(await missingName.json(), { error: 'name is required' })
  } finally { await close() }
})

// --- wi-7 /health keeps its own shape next to the richer Item shape ---------

test('GET /health is exactly status, uptime_seconds and version — no tags or created_at leaked in', async () => {
  const { base, close } = await start()
  try {
    await created(base, { name: 'widget', tags: ['t'] })
    const body = await (await fetch(`${base}/health`)).json()
    assert.deepEqual(Object.keys(body).sort(), ['status', 'uptime_seconds', 'version'])
    assert.equal(body.status, 'ok')
    assert.equal(typeof body.version, 'string')
    assert.ok(body.version.length > 0)
  } finally { await close() }
})

// --- wi-9 request logger, still silent under NODE_ENV=test -----------------

test('request logger is suppressed under NODE_ENV=test and re-reads NODE_ENV per request', async () => {
  const { base, close } = await start()
  const original = process.stdout.write.bind(process.stdout)
  const captured = []
  const previousEnv = process.env.NODE_ENV
  process.stdout.write = (chunk, ...rest) => {
    captured.push(String(chunk))
    return original(chunk, ...rest)
  }
  // node:test writes its own (binary) reporter chunks to this same stream, so
  // each captured chunk is split on its own rather than joined first.
  const logLines = () => captured.flatMap(c => c.split('\n')).filter(l => /^(GET|POST|PUT|PATCH|DELETE|HEAD) \/\S* \d{3} \d+$/.test(l))
  const settle = () => new Promise(r => setTimeout(r, 50))
  try {
    assert.equal(previousEnv, 'test', 'npm test must set NODE_ENV=test (wi-9 ac-12)')
    await fetch(`${base}/health`)
    await settle()
    assert.deepEqual(logLines(), [], 'no request-log lines while NODE_ENV=test')

    process.env.NODE_ENV = 'production'
    await fetch(`${base}/items/abc`)
    await settle()
    const afterEnable = logLines()
    assert.equal(afterEnable.length, 1, 'exactly one line once logging is enabled')
    assert.match(afterEnable[0], /^GET \/items\/abc 404 \d+$/)

    process.env.NODE_ENV = 'test'
    await fetch(`${base}/items`)
    await settle()
    assert.equal(logLines().length, 1, 'the NODE_ENV check is re-read per request')
  } finally {
    process.stdout.write = original
    process.env.NODE_ENV = previousEnv
    await close()
  }
})

test('logger excludes the query string and does not alter any merged response', async () => {
  const { base, close } = await start()
  const original = process.stdout.write.bind(process.stdout)
  const captured = []
  const previousEnv = process.env.NODE_ENV
  process.stdout.write = (chunk, ...rest) => {
    captured.push(String(chunk))
    return original(chunk, ...rest)
  }
  try {
    process.env.NODE_ENV = 'production'
    const item = await created(base, { name: 'widget', tags: ['t'] })
    const listed = await fetch(`${base}/items?sort=name&limit=1`)
    assert.equal(listed.status, 200)
    assert.deepEqual(await listed.json(), [item])
    await new Promise(r => setTimeout(r, 50))

    const lines = captured.flatMap(c => c.split('\n')).filter(l => /^(GET|POST) \/\S* \d{3} \d+$/.test(l))
    assert.ok(lines.some(l => /^POST \/items 201 \d+$/.test(l)), `expected POST line, got ${JSON.stringify(lines)}`)
    assert.ok(lines.some(l => /^GET \/items 200 \d+$/.test(l)), `expected query-free GET line, got ${JSON.stringify(lines)}`)
    assert.ok(!lines.some(l => l.includes('?')), 'query string must not appear in the logged path')
  } finally {
    process.stdout.write = original
    process.env.NODE_ENV = previousEnv
    await close()
  }
})
