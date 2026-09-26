// AC-14: if a webhook driver is shipped, nothing — not the README, not a test — claims it is verified
// against a real external service; any webhook test targets only 127.0.0.1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

// A bare host[.tld] that is not 127.0.0.1 or localhost — used to catch a webhook test or doc claim that
// slipped in a real external endpoint.
const REAL_HOST = /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+/i

test('AC-14: if shipped, the webhook driver is never called verified, and its tests target only 127.0.0.1', () => {
  const notifySrc = fs.readFileSync(path.join(REPO, 'substrate', 'notify.js'), 'utf8')
  if (!/webhook/i.test(notifySrc)) return // optional driver not shipped; nothing to check

  const readme = fs.readFileSync(path.join(REPO, 'substrate', 'README.md'), 'utf8')
  const readmeWebhookLines = readme.split('\n').filter(l => /webhook/i.test(l))
  for (const line of readmeWebhookLines) {
    assert.doesNotMatch(line, /\bverified\b(?!.*UNVERIFIED)/i, `README line claims webhook is verified: ${line}`)
  }
  assert.match(readme, /UNVERIFIED FROM CI/)

  const testDir = path.join(REPO, 'substrate', 'test')
  for (const f of fs.readdirSync(testDir)) {
    if (!f.endsWith('.test.js')) continue
    const text = fs.readFileSync(path.join(testDir, f), 'utf8')
    if (!/webhook/i.test(text)) continue
    assert.doesNotMatch(text, REAL_HOST, `${f} appears to target a real host in a webhook test`)
    assert.doesNotMatch(text, /verified against (a real|an external)/i)
  }
})
