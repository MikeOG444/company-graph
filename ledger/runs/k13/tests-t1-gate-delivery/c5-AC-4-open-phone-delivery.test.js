// AC-4: `gates open` for a phone-channel gate (sev1_page) delivers a labelled GitHub issue through the
// configured driver, records a successful delivery on the GateRecord, and leaves the CLI contract
// (exit code, stdout) untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from '../../../substrate/test/helpers.js'
import { startServer, jsonResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

test('AC-4: gates open delivers to phone for sev1_page and stamps a successful delivery', async () => {
  const server = await startServer(jsonResponder(201, () => ({ html_url: 'http://127.0.0.1/issues/1' })))
  try {
    await withEnv({
      NOTIFY_DRIVER: 'github',
      NOTIFY_GITHUB_TOKEN: 'ghp_test_token_abc',
      NOTIFY_GITHUB_REPO: 'acme/ops',
      NOTIFY_GITHUB_API: server.url,
    }, async () => {
      const root = tmpRoot()
      const open = cli('gates', [
        'open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
        '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z',
      ], { root })

      assert.equal(open.code, 0, open.err)
      assert.equal(open.out, 'r1-sev1_page')

      const recPath = path.join(root, 'gates', 'open', 'r1-sev1_page.json')
      assert.ok(fs.existsSync(recPath))
      const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
      assert.ok(rec.delivery, 'record should carry a delivery object')
      assert.equal(rec.delivery.attempted, true)
      assert.equal(rec.delivery.ok, true)
      assert.equal(rec.delivery.channel, 'phone')
      assert.ok(!Number.isNaN(Date.parse(rec.delivery.at)))
      assert.ok(!('error' in rec.delivery))

      assert.equal(server.requests.length, 1)
      const [req] = server.requests
      assert.equal(req.method, 'POST')
      assert.match(req.url, /\/repos\/acme\/ops\/issues$/)
      assert.match(String(req.headers.authorization), /ghp_test_token_abc/)
      assert.ok(Array.isArray(req.body.labels), 'issue body should carry labels')
      assert.ok(req.body.labels.includes('gate'))
      assert.ok(req.body.labels.some(l => /phone/.test(l)))
      const bodyText = JSON.stringify(req.body)
      assert.match(bodyText, /sev1_page/)
      assert.match(bodyText, /gates\/open\/r1-sev1_page\.json/)
    })
  } finally {
    await server.close()
  }
})
