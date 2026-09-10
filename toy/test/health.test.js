import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { start } from './helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: EXPECTED_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
)

test('GET /health returns ok, uptime_seconds and version', async () => {
  const { base, close } = await start()
  try {
    const before = Math.floor(process.uptime())
    const res = await fetch(`${base}/health`)
    const after = Math.floor(process.uptime())

    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') || '', /application\/json/)

    const body = await res.json()
    assert.deepEqual(Object.keys(body).sort(), ['status', 'uptime_seconds', 'version'])
    assert.equal(body.status, 'ok')
    assert.equal(typeof body.uptime_seconds, 'number')
    assert.equal(Number.isInteger(body.uptime_seconds), true)
    assert.ok(body.uptime_seconds >= 0)
    assert.ok(body.uptime_seconds >= before)
    assert.ok(body.uptime_seconds <= after + 1)
    assert.equal(body.version, EXPECTED_VERSION)
  } finally { await close() }
})

test('GET /health uptime_seconds increases with elapsed time; version stays identical', async () => {
  const { base, close } = await start()
  try {
    const res1 = await fetch(`${base}/health`)
    const { uptime_seconds: u1, version: v1 } = await res1.json()

    await new Promise(r => setTimeout(r, 1100))

    const res2 = await fetch(`${base}/health`)
    const { uptime_seconds: u2, version: v2 } = await res2.json()

    assert.ok(u2 > u1)
    assert.ok(u2 - u1 >= 1)
    assert.equal(v2, v1)
    assert.equal(typeof v1, 'string')
    assert.ok(v1.length > 0)
  } finally { await close() }
})

test('GET /health uptime_seconds derives from process start, not per-instance; version is process-wide', async () => {
  const a = await start()
  const b = await start()
  try {
    const bodyA = await (await fetch(`${a.base}/health`)).json()
    const bodyB = await (await fetch(`${b.base}/health`)).json()

    assert.equal(Number.isInteger(bodyA.uptime_seconds), true)
    assert.equal(Number.isInteger(bodyB.uptime_seconds), true)
    assert.ok(Math.abs(bodyA.uptime_seconds - bodyB.uptime_seconds) <= 1)
    assert.equal(bodyA.version, bodyB.version)
    assert.equal(bodyA.version, EXPECTED_VERSION)
  } finally {
    await a.close()
    await b.close()
  }
})
