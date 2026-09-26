// AC-8: no driver configured (unset, unknown name, or a selected driver missing its required settings)
// never fails the gate and never makes a network connection.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from '../../../substrate/test/helpers.js'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'
import { startServer, jsonResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

async function openAndCheck(server, extraEnv) {
  return withEnv(extraEnv, async () => {
    const root = tmpRoot()
    const open = cli('gates', [
      'open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
      '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z',
    ], { root })

    assert.equal(open.code, 0, open.err)
    assert.equal(open.out, 'r1-sev1_page')

    const recPath = path.join(root, 'gates', 'open', 'r1-sev1_page.json')
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
    const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
    assert.ok(validate('GateRecord', rec).ok)

    assert.equal(rec.delivery.ok, false)
    assert.equal(rec.delivery.channel, 'phone')
    assert.equal(typeof rec.delivery.error, 'string')
    assert.ok(rec.delivery.error.length > 0)
    assert.equal(server.requests.length, 0, 'no driver configuration should ever reach the network')
    return rec
  })
}

test('AC-8: no NOTIFY_DRIVER set at all', async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  try {
    // Point NOTIFY_GITHUB_API at a live server so a failure to honor "unset = no driver" would be caught.
    const rec = await openAndCheck(server, { NOTIFY_GITHUB_API: server.url })
    assert.equal(rec.delivery.attempted, false)
    assert.match(rec.delivery.error, /not configured|no driver|unset/i)
  } finally {
    await server.close()
  }
})

test('AC-8: an unknown driver name', async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  try {
    const rec = await openAndCheck(server, { NOTIFY_DRIVER: 'carrier-pigeon', NOTIFY_GITHUB_API: server.url })
    assert.equal(rec.delivery.attempted, false)
  } finally {
    await server.close()
  }
})

test('AC-8: github driver selected but missing token and repo', async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  try {
    await openAndCheck(server, { NOTIFY_DRIVER: 'github', NOTIFY_GITHUB_API: server.url })
  } finally {
    await server.close()
  }
})
