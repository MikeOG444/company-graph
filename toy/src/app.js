import express from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Resolved once at module load, relative to this file's own location so it
// is independent of process.cwd() or where the app is invoked from.
const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(__dirname, '..', 'package.json')
const { version: VERSION } = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

// In-memory store. Reset per app instance so tests are isolated.
export function createApp() {
  const app = express()

  // Cross-cutting request logger: after each response is sent, writes one
  // line to stdout: "METHOD PATH STATUS ELAPSED_MS\n". Suppressed when
  // process.env.NODE_ENV === 'test', re-checked per request (not cached)
  // so tests can toggle it at runtime. Query strings are excluded from the
  // logged path (req.path), and the path is logged as received, without
  // percent-decoding or normalization.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint()
    res.on('finish', () => {
      if (process.env.NODE_ENV === 'test') return
      const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6)
      // req.path is percent-decoded by Express; use the raw originalUrl
      // (as received on the wire) and strip the query string ourselves so
      // the logged path is neither decoded nor normalized.
      const rawPath = req.originalUrl.split('?')[0]
      process.stdout.write(`${req.method} ${rawPath} ${res.statusCode} ${elapsedMs}\n`)
    })
    next()
  })

  app.use(express.json())
  const items = new Map()
  let nextId = 1

  // GET /health → { status: "ok", uptime_seconds: <integer seconds since process start>, version: <package.json version> }
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()), version: VERSION })
  })

  // GET /items → Item[] ; optional ?q= ; optional ?sort=name|id ; optional ?limit=N ; 400 { error: "invalid q" } or { error: "invalid sort" } or { error: "invalid limit" }
  // q: when present it must be a plain string (Express parses a repeated key, e.g. ?q=a&q=b, as an
  // array, and a bracketed key, e.g. ?q[x]=y, as an object; both are a 400). A missing or empty string
  // matches everything. Matching is a case-insensitive, literal, contiguous substring test against
  // `name` — both sides lower-cased with toLowerCase(), no trimming, no regex, no locale folding.
  // sort: when present it must be 'name' or 'id'. Any other value (including "", case variants, padding, or a repeated parameter, which Express parses as an array) is a 400.
  // limit: when present it must be a canonical positive decimal integer (/^[1-9][0-9]*$/) within Number.isSafeInteger range. Any other value is a 400.
  // Unknown query parameters are ignored.
  //
  // Pipeline: filter -> sort -> cap. The ?q filter runs first against the full insertion-ordered
  // list, so a limit cap never counts an item that q excluded.
  app.get('/items', (req, res) => {
    const q = req.query.q
    if (q !== undefined && typeof q !== 'string') {
      return res.status(400).json({ error: 'invalid q' })
    }

    const sort = req.query.sort
    if (sort !== undefined && sort !== 'name' && sort !== 'id') {
      return res.status(400).json({ error: 'invalid sort' })
    }

    const raw = req.query.limit
    let limit
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        return res.status(400).json({ error: 'invalid limit' })
      }
      limit = Number(raw)
    }

    let result = [...items.values()]

    // ?q substring filter — narrow the full insertion-ordered list first,
    // so a limit cap never counts an item that q excluded.
    if (q) {
      const needle = q.toLowerCase()
      result = result.filter((item) => item.name.toLowerCase().includes(needle))
    }

    // sort stage — plain code-unit comparison, no locale/case folding.
    // sort === 'id' (or absent) keeps the existing insertion order, which
    // already matches ascending id order, so no reordering is needed. The
    // sort below never mutates `items` or the array captured above; it
    // operates on and returns a fresh copy, and Array#sort is a stable sort.
    if (sort === 'name') {
      result = [...result].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    }

    // X-Total-Count reports the number of items matching after the ?q
    // filter and before the ?limit cap, so a client can tell a truncated
    // page from a complete one by comparing this value to the length of
    // the returned array. Sorting never changes this count, only order.
    // Set on every successful response from this route (capped, uncapped,
    // or zero matches) and only on this route's 200s — never on the 400s
    // above, which return before a match set exists.
    res.set('X-Total-Count', String(result.length))

    // cap stage — apply limit if present
    if (limit !== undefined) {
      result = result.slice(0, limit)
    }

    res.json(result)
  })

  // GET /items/:id → 200 Item ; 404 { error: "not found" } when :id is not a
  // canonical decimal integer or names no item.
  app.get('/items/:id', (req, res) => {
    const raw = req.params.id
    if (!/^\d+$/.test(raw) || String(Number(raw)) !== raw) {
      return res.status(404).json({ error: 'not found' })
    }
    const item = items.get(Number(raw))
    if (!item) {
      return res.status(404).json({ error: 'not found' })
    }
    res.json(item)
  })

  // POST /items { name, tags? } → 201 Item ; 400 when name missing or not a
  // string ; 400 when name is longer than 64 UTF-16 code units ; 400 when
  // tags (if present) is not an array of 1-32 character strings with at
  // most 10 entries
  const MAX_NAME_LENGTH = 64
  const MAX_TAGS = 10
  const MIN_TAG_LENGTH = 1
  const MAX_TAG_LENGTH = 32

  function isValidTags(tags) {
    if (!Array.isArray(tags)) {
      return false
    }
    if (tags.length > MAX_TAGS) {
      return false
    }
    return tags.every(
      (tag) =>
        typeof tag === 'string' &&
        tag.length >= MIN_TAG_LENGTH &&
        tag.length <= MAX_TAG_LENGTH
    )
  }

  app.post('/items', (req, res) => {
    const name = req.body?.name
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'name is required' })
    }
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: 'name too long' })
    }
    const hasTags = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'tags')
    const rawTags = req.body?.tags
    if (hasTags && !isValidTags(rawTags)) {
      return res.status(400).json({ error: 'invalid tags' })
    }
    const tags = hasTags ? rawTags : []
    const item = { id: nextId++, name, tags, created_at: new Date().toISOString() }
    items.set(item.id, item)
    res.status(201).json(item)
  })

  // DELETE /items/:id → 204 (empty body) ; 401 { error: "unauthorized" } when
  // the Authorization header is not a valid admin bearer token ; 404
  // { error: "not found" } when :id is not a canonical decimal integer or
  // names no item.
  //
  // Auth is checked first, before id validation or existence lookup, so an
  // unauthenticated caller never learns whether an item exists. The admin
  // token is read from process.env.ADMIN_TOKEN on every request (not
  // captured at createApp() time), so it can be set/unset around a running
  // app instance. An unset or empty ADMIN_TOKEN means "no admin configured"
  // and every request is rejected with 401. The Authorization header must
  // be the Bearer scheme (case-insensitive) followed by exactly one space
  // and the token, compared with exact (case-sensitive) string equality.
  app.delete('/items/:id', (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN
    const authHeader = req.get('authorization')

    let providedToken
    if (typeof authHeader === 'string') {
      const spaceIndex = authHeader.indexOf(' ')
      if (spaceIndex !== -1) {
        const scheme = authHeader.slice(0, spaceIndex)
        const rest = authHeader.slice(spaceIndex + 1)
        if (scheme.toLowerCase() === 'bearer' && !rest.includes(' ')) {
          providedToken = rest
        }
      }
    }

    if (
      !adminToken ||
      providedToken === undefined ||
      providedToken === '' ||
      providedToken !== adminToken
    ) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const raw = req.params.id
    if (!/^\d+$/.test(raw) || String(Number(raw)) !== raw) {
      return res.status(404).json({ error: 'not found' })
    }
    const id = Number(raw)
    if (!items.has(id)) {
      return res.status(404).json({ error: 'not found' })
    }
    items.delete(id)
    res.status(204).end()
  })

  // Terminal catch-all: any request that matched no route above falls
  // through to here. Replaces Express's default HTML 404 with the same
  // JSON shape used elsewhere in this API.
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  return app
}
