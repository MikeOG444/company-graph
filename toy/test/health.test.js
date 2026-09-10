import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from './helpers.js'

test('GET /health returns ok', async () => {
  const { base, close } = await start()
  try {
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'ok' })
  } finally { await close() }
})
