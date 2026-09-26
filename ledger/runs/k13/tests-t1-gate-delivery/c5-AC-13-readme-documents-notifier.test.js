// AC-13: substrate/README.md documents the driver-selection env var and each driver's env vars, the
// phone/queue routing table, the reachable-transport constraint, and (if shipped) the webhook driver's
// UNVERIFIED FROM CI status.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'

test('AC-13: README documents every notifier env var pinned by the interface', () => {
  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  for (const envVar of [
    'NOTIFY_DRIVER', 'NOTIFY_GITHUB_TOKEN', 'NOTIFY_GITHUB_REPO', 'NOTIFY_GITHUB_API',
    'NOTIFY_WEBHOOK_URL', 'NOTIFY_TIMEOUT_MS',
  ]) {
    assert.match(readme, new RegExp(envVar), `README should document ${envVar}`)
  }
})

test('AC-13: README documents the phone/queue routing table', () => {
  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  assert.match(readme, /sev1_page/)
  assert.match(readme, /phone/)
  assert.match(readme, /spec_gate/)
  assert.match(readme, /queue/)
  assert.match(readme, /budget[_-]breach/i)
})

test('AC-13: README documents the reachable-transport constraint', () => {
  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  assert.match(readme, /api\.github\.com/)
  assert.match(readme, /403/)
  for (const host of ['ntfy.sh', 'hooks.slack.com', 'api.pushover.net', 'api.telegram.org', 'api.twilio.com']) {
    assert.match(readme, new RegExp(host.replace(/\./g, '\\.')), `README should name ${host} as unreachable`)
  }
})

test('AC-13: README documents that delivery is best-effort and the record on disk is the source of truth', () => {
  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  assert.match(readme, /best-effort/i)
  assert.match(readme, /source of truth/i)
})

test('AC-13: if a webhook driver ships, README marks it UNVERIFIED FROM CI', async () => {
  const notifySrc = fs.readFileSync(path.join(REPO, 'substrate', 'notify.js'), 'utf8')
  if (!/webhook/i.test(notifySrc)) return // optional driver not shipped; nothing to require here
  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  assert.match(readme, /webhook/i)
  assert.match(readme, /UNVERIFIED FROM CI/)
})
