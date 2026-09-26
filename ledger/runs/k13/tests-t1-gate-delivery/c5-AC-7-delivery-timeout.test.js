// AC-7: the GitHub driver, pointed at a server that accepts the connection and never responds, times
// out at the documented env var and never blocks the gate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from '../../../substrate/test/helpers.js'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'
import { startServer, hangResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

test('AC-7: a driver that never responds times out well before the process would otherwise wait', async () => {
  const server = await startServer(hangResponder())
  try {
    await withEnv({
      NOTIFY_DRIVER: 'github',
      NOTIFY_GITHUB_TOKEN: 'ghp_test_token',
      NOTIFY_GITHUB_REPO: 'acme/ops',
      NOTIFY_GITHUB_API: server.url,
      NOTIFY_TIMEOUT_MS: '300',
    }, async () => {
      const root = tmpRoot()
      const started = Date.now()
      const open = cli('gates', [
        'open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
        '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z',
      ], { root })
      const elapsedMs = Date.now() - started

      assert.equal(open.code, 0, open.err)
      assert.equal(open.out, 'r1-sev1_page')
      assert.ok(elapsedMs < 5000, `expected the CLI to return quickly, took ${elapsedMs}ms`)

      const recPath = path.join(root, 'gates', 'open', 'r1-sev1_page.json')
      const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
      const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
      assert.ok(validate('GateRecord', rec).ok)

      assert.equal(rec.delivery.attempted, true)
      assert.equal(rec.delivery.ok, false)
      assert.match(rec.delivery.error, /timeout|timed out/i)
    })
  } finally {
    await server.close()
  }
})
