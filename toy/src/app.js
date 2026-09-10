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
  app.use(express.json())
  const items = new Map()
  let nextId = 1

  // GET /health → { status: "ok", uptime_seconds: <integer seconds since process start>, version: <package.json version> }
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()), version: VERSION })
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
