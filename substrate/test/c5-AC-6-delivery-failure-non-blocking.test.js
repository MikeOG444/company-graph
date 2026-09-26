// AC-6: a delivery that the driver fails to complete (server 500, or connection refused) never fails
// the gate: exit 0, stdout is the bare gate id, the record is written and validates, and the failure is
// recorded on delivery, not lost.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpRoot } from './helpers.js'
import { cliAsync as cli } from './c5-cli.js'
import { REPO } from './fixloop-helpers.js'
import { startServer, jsonResponder, closedPortUrl } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

async function runAndCheck(apiUrl) {
  const root = tmpRoot()
  const open = await cli('gates', [
    'open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
    '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z',
  ], { root })

  assert.equal(open.code, 0, open.err)
  assert.equal(open.out, 'r1-sev1_page')
  assert.doesNotMatch(open.out, /error/i)

  const recPath = path.join(root, 'gates', 'open', 'r1-sev1_page.json')
  assert.ok(fs.existsSync(recPath))
  const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))

  const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
  assert.ok(validate('GateRecord', rec).ok)

  assert.equal(rec.delivery.attempted, true)
  assert.equal(rec.delivery.ok, false)
  assert.equal(typeof rec.delivery.error, 'string')
  assert.ok(rec.delivery.error.length > 0)
}

test('AC-6: server responds 500 to the create-issue POST', async () => {
  const server = await startServer(jsonResponder(500, { message: 'server error' }))
  try {
    await withEnv({
      NOTIFY_DRIVER: 'github',
      NOTIFY_GITHUB_TOKEN: 'ghp_test_token',
      NOTIFY_GITHUB_REPO: 'acme/ops',
      NOTIFY_GITHUB_API: server.url,
    }, () => runAndCheck(server.url))
  } finally {
    await server.close()
  }
})

test('AC-6: connection is refused (closed 127.0.0.1 port)', async () => {
  const url = await closedPortUrl()
  await withEnv({
    NOTIFY_DRIVER: 'github',
    NOTIFY_GITHUB_TOKEN: 'ghp_test_token',
    NOTIFY_GITHUB_REPO: 'acme/ops',
    NOTIFY_GITHUB_API: url,
  }, () => runAndCheck(url))
})
