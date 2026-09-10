import express from 'express'

// In-memory store. Reset per app instance so tests are isolated.
export function createApp() {
  const app = express()
  app.use(express.json())
  const items = new Map()
  let nextId = 1

  // GET /health → { status: "ok" }
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  // GET /items → Item[]
  app.get('/items', (req, res) => {
    res.json([...items.values()])
  })

  // POST /items { name } → 201 Item ; 400 when name missing or not a string
  app.post('/items', (req, res) => {
    const name = req.body?.name
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'name is required' })
    }
    const item = { id: nextId++, name }
    items.set(item.id, item)
    res.status(201).json(item)
  })

  return app
}
