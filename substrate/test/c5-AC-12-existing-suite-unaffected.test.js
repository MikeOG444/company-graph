// AC-12: with no notifier env vars set, the pre-existing gates CLI behavior is unchanged (mirrors
// substrate/test/gates.test.js's open→list→decide round trip), and a GitHub token alone — without
// NOTIFY_DRIVER selecting it — never enables delivery or reaches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpRoot } from './helpers.js'
import { cliAsync as cli } from './c5-cli.js'
import { startServer, jsonResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

test('AC-12: open→list→decide round trip is unchanged with no notifier env vars set', async () => {
  const root = tmpRoot()
  const payload = path.join(root, 'gated.json')
  fs.writeFileSync(payload, JSON.stringify({ specs: ['spec-7'] }))

  const open = await cli('gates', ['open', '--gate', 'spec_gate', '--run', 'r1', '--workflow', 'build-spec',
    '--options', 'approve,revise,kill', '--payload', payload, '--next', 'build-implement', '--now', '2026-09-10T10:00:00Z'], { root })
  assert.equal(open.code, 0, open.err)
  assert.equal(open.out, 'r1-spec_gate')
  const rec = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'open', 'r1-spec_gate.json'), 'utf8'))
  assert.equal(rec.status, 'open')
  assert.deepEqual(rec.options, ['approve', 'revise', 'kill'])
  assert.deepEqual(rec.payload, { specs: ['spec-7'] })
  assert.equal(rec.provenance.method, 'hitl')

  const list = await cli('gates', ['list'], { root })
  assert.match(list.out, /r1-spec_gate\topen\tspec_gate/)

  const dec = await cli('gates', ['decide', 'r1-spec_gate', 'approve', '--note', 'fine', '--now', '2026-09-10T11:00:00Z'], { root })
  assert.equal(dec.code, 0, dec.err)
  assert.match(dec.out, /next: \/build-implement/)
  assert.match(dec.out, /"decision":"approve"/)
  const closed = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'closed', 'r1-spec_gate.json'), 'utf8'))
  assert.equal(closed.status, 'decided')
  assert.equal(closed.decision.option, 'approve')
})

test('AC-12: a GITHUB_TOKEN alone (no NOTIFY_DRIVER) never enables delivery or touches the network', async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  try {
    await withEnv({
      GITHUB_TOKEN: 'ghp_should_never_be_read',
      NOTIFY_GITHUB_API: server.url,
      NOTIFY_GITHUB_REPO: 'acme/ops',
    }, async () => {
      const root = tmpRoot()
      const open = await cli('gates', ['open', '--gate', 'spec_gate', '--run', 'r1', '--workflow', 'build-spec',
        '--options', 'approve,revise,kill', '--now', '2026-09-10T10:00:00Z'], { root })
      assert.equal(open.code, 0, open.err)
      assert.equal(open.out, 'r1-spec_gate')
      const rec = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'open', 'r1-spec_gate.json'), 'utf8'))
      assert.equal(rec.delivery.attempted, false)
      assert.equal(server.requests.length, 0)
    })
  } finally {
    await server.close()
  }
})

// k13d: the GITHUB_TOKEN test above sets no NOTIFY_DRIVER, so a driver that fell back to GITHUB_TOKEN once
// selected survived it. With the github driver selected and ONLY GITHUB_TOKEN present, delivery must still be
// "not configured" and no request may leave.
test('AC-12 (k13d): with NOTIFY_DRIVER=github and only GITHUB_TOKEN set, the token is never used', { timeout: 10000 }, async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  const saved = process.env.NOTIFY_GITHUB_TOKEN
  delete process.env.NOTIFY_GITHUB_TOKEN
  try {
    await withEnv({ NOTIFY_DRIVER: 'github', GITHUB_TOKEN: 'ghp_should_never_be_read', NOTIFY_GITHUB_API: server.url, NOTIFY_GITHUB_REPO: 'acme/ops' }, async () => {
      const root = tmpRoot()
      const open = await cli('gates', ['open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
        '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z'], { root })
      assert.equal(open.code, 0, open.err)
      const rec = JSON.parse(fs.readFileSync(path.join(root, 'gates', 'open', 'r1-sev1_page.json'), 'utf8'))
      assert.equal(rec.delivery.ok, false)
      assert.match(rec.delivery.error, /not configured/)
      assert.equal(server.requests.length, 0, 'GITHUB_TOKEN must never be sent')
    })
  } finally {
    if (saved !== undefined) process.env.NOTIFY_GITHUB_TOKEN = saved
    await server.close()
  }
})
