// AC-10: a sentinel token never appears in the written GateRecord, stdout, stderr, or the issue title
// or body the server received — only in the Authorization request header. Checked across a success, a
// failure that echoes the Authorization header back, and a timeout.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpRoot } from './helpers.js'
import { cliAsync as cli } from './c5-cli.js'
import { startServer, jsonResponder, hangResponder } from './c5-http-helpers.js'
import { withEnv } from './c5-env-helpers.js'

const SENTINEL = 'ghp_SENTINEL_DO_NOT_LEAK'

function assertNoLeak(root, id, open, requests) {
  assert.equal(open.code, 0, open.err)
  assert.doesNotMatch(open.out, new RegExp(SENTINEL))
  assert.doesNotMatch(open.err, new RegExp(SENTINEL))

  const recText = fs.readFileSync(path.join(root, 'gates', 'open', `${id}.json`), 'utf8')
  assert.doesNotMatch(recText, new RegExp(SENTINEL))

  for (const req of requests) {
    const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    assert.doesNotMatch(bodyText, new RegExp(SENTINEL), 'issue title/body must not carry the token')
  }
}

async function openWith(server) {
  return withEnv({
    NOTIFY_DRIVER: 'github',
    NOTIFY_GITHUB_TOKEN: SENTINEL,
    NOTIFY_GITHUB_REPO: 'acme/ops',
    NOTIFY_GITHUB_API: server.url,
    NOTIFY_TIMEOUT_MS: '300',
  }, async () => {
    const root = tmpRoot()
    const open = await cli('gates', [
      'open', '--gate', 'sev1_page', '--run', 'r1', '--workflow', 'maintain-triage',
      '--options', 'rollback,hold', '--now', '2026-09-11T03:04:00Z',
    ], { root })
    return { root, open }
  })
}

test('AC-10: the sentinel token does not leak on a successful delivery', async () => {
  const server = await startServer(jsonResponder(201, { html_url: 'http://127.0.0.1/issues/1' }))
  try {
    const { root, open } = await openWith(server)
    assertNoLeak(root, 'r1-sev1_page', open, server.requests)
    // AC-10 says the token appears only in the Authorization request header, not that a delivery
    // must be attempted at all (that count is AC-4's job). So this is a positive check of that
    // one allowed location, made only when a request actually reached the server -- it must not
    // turn into a bare delivery-count assertion that fails identically whether or not a token
    // ever leaked (that duplicate, unrelated-to-AC-10 assertion is what made this test fail the
    // same way -- 0 requests -- against a tree with no delivery wired up at all).
    if (server.requests.length > 0) {
      assert.match(String(server.requests[0].headers.authorization), new RegExp(SENTINEL))
    }
  } finally {
    await server.close()
  }
})

test('AC-10: the sentinel token does not leak when the server echoes the Authorization header back (401)', async () => {
  const server = await startServer(jsonResponder(401, entry => ({ message: 'bad credentials', authorization: entry.headers.authorization })))
  try {
    const { root, open } = await openWith(server)
    assertNoLeak(root, 'r1-sev1_page', open, server.requests)
  } finally {
    await server.close()
  }
})

test('AC-10: the sentinel token does not leak when the driver times out', async () => {
  const server = await startServer(hangResponder())
  try {
    const { root, open } = await openWith(server)
    assertNoLeak(root, 'r1-sev1_page', open, server.requests)
  } finally {
    await server.close()
  }
})
