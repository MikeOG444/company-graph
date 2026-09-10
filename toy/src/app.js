import express from 'express'

// In-memory store. Reset per app instance so tests are isolated.
export function createApp() {
  const app = express()
  app.use(express.json())
  const items = new Map()
  let nextId = 1

  // GET /health → { status: "ok", uptime_seconds: <integer seconds since process start> }
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) })
  })

  // GET /items → Item[]
  app.get('/items', (req, res) => {
    res.json([...items.values()])
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
    const item = { id: nextId++, name, tags }
    items.set(item.id, item)
    res.status(201).json(item)
  })

  return app
}
