// AC-5: the same setup as AC-4, but for a queue-channel gate (spec_gate) — the issue carries the
// queue-channel label instead of the phone label, and the exit code is still 0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from '../../../substrate/test/helpers.js'
import { startServer, jsonResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

test('AC-5: gates open delivers to queue for spec_gate', async () => {
  const server = await startServer(jsonResponder(201, () => ({ html_url: 'http://127.0.0.1/issues/2' })))
  try {
    await withEnv({
      NOTIFY_DRIVER: 'github',
      NOTIFY_GITHUB_TOKEN: 'ghp_test_token_xyz',
      NOTIFY_GITHUB_REPO: 'acme/ops',
      NOTIFY_GITHUB_API: server.url,
    }, async () => {
      const root = tmpRoot()
      const open = cli('gates', [
        'open', '--gate', 'spec_gate', '--run', 'r1', '--workflow', 'build-spec',
        '--options', 'approve,revise,kill', '--now', '2026-09-11T03:04:00Z',
      ], { root })

      assert.equal(open.code, 0, open.err)
      assert.equal(open.out, 'r1-spec_gate')

      const recPath = path.join(root, 'gates', 'open', 'r1-spec_gate.json')
      const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
      assert.equal(rec.delivery.channel, 'queue')
      assert.equal(rec.delivery.ok, true)

      assert.equal(server.requests.length, 1)
      const [req] = server.requests
      assert.ok(Array.isArray(req.body.labels))
      assert.ok(req.body.labels.some(l => /queue/.test(l)))
      assert.ok(!req.body.labels.some(l => /phone/.test(l)))
    })
  } finally {
    await server.close()
  }
})
