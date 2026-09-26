// AC-11: `gates decide` carries the delivery object, unchanged, into gates/closed/, and makes no
// notification attempt of its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from '../../../substrate/test/helpers.js'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'
import { startServer, jsonResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

test('AC-11: deciding a gate keeps its delivery object and does not notify again', async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  try {
    await withEnv({
      NOTIFY_DRIVER: 'github',
      NOTIFY_GITHUB_TOKEN: 'ghp_test_token',
      NOTIFY_GITHUB_REPO: 'acme/ops',
      NOTIFY_GITHUB_API: server.url,
    }, async () => {
      const root = tmpRoot()
      const open = cli('gates', [
        'open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
        '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z',
      ], { root })
      assert.equal(open.code, 0, open.err)
      const openRec = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'open', 'r1-sev1_page.json'), 'utf8'))
      assert.equal(server.requests.length, 1)

      const dec = cli('gates', ['decide', 'r1-sev1_page', 'rollback', '--now', '2026-09-11T04:00:00Z'], { root })
      assert.equal(dec.code, 0, dec.err)

      assert.ok(!fs.existsSync(path.join(root, 'gates', 'open', 'r1-sev1_page.json')))
      const closedRec = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'closed', 'r1-sev1_page.json'), 'utf8'))
      assert.deepEqual(closedRec.delivery, openRec.delivery)

      const { validate } = await import(path.join(REPO, 'substrate', 'lib', 'contracts.js'))
      assert.ok(validate('GateRecord', closedRec).ok)

      // decide made no delivery attempt of its own
      assert.equal(server.requests.length, 1)
    })
  } finally {
    await server.close()
  }
})
