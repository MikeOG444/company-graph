import express from 'express'

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
