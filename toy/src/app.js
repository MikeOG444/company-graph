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

  // GET /items → Item[] ; optional ?sort=name|id ; 400 { error: "invalid sort" }
  // for any other present value (including "", case variants, padding, or a
  // repeated parameter, which Express parses as an array).
  //
  // Pipeline: filter -> sort -> cap. Filtering (?q, wi-6) and capping
  // (?limit, wi-5) are not implemented yet; this shape leaves room for them
  // to compose around the sort stage without restructuring the handler.
  app.get('/items', (req, res) => {
    const sort = req.query.sort
    if (sort !== undefined && sort !== 'name' && sort !== 'id') {
      return res.status(400).json({ error: 'invalid sort' })
    }

    // filter stage (no-op today; ?q substring filter lands here in wi-6)
    let result = [...items.values()]

    // sort stage — plain code-unit comparison, no locale/case folding.
    // sort === 'id' (or absent) keeps the existing insertion order, which
    // already matches ascending id order, so no reordering is needed. The
    // sort below never mutates `items` or the array captured above; it
    // operates on and returns a fresh copy, and Array#sort is a stable sort.
    if (sort === 'name') {
      result = [...result].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    }

    // cap stage (no-op today; ?limit lands here in wi-5)

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

  // POST /items { name } → 201 Item ; 400 when name missing or not a string ;
  // 400 when name is longer than 64 UTF-16 code units
  const MAX_NAME_LENGTH = 64
  app.post('/items', (req, res) => {
    const name = req.body?.name
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'name is required' })
    }
    if (name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: 'name too long' })
    }
    const item = { id: nextId++, name }
    items.set(item.id, item)
    res.status(201).json(item)
  })

  return app
}
