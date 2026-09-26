// AC-3: substrate/notify.js's routing table sends sev1_page and budget-breach gates to the `phone`
// channel; every other gate (including unknown names) goes to `queue`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { REPO } from '../../../substrate/test/fixloop-helpers.js'

test('AC-3: sev1_page and budget-breach gate names route to phone', async () => {
  const { channelFor } = await import(path.join(REPO, 'substrate', 'notify.js'))
  for (const gate of ['sev1_page', 'ratio_gate', 'nightly_budget_breach', 'cost_budget_breach']) {
    assert.equal(channelFor(gate), 'phone', `expected ${gate} to route to phone`)
  }
})

test('AC-3: spec_gate and the other named gates, plus any unknown gate name, route to queue', async () => {
  const { channelFor } = await import(path.join(REPO, 'substrate', 'notify.js'))
  for (const gate of ['spec_gate', 'launch_approval', 'escalation', 'roadmap_gate', 'brief_approval', 'a_gate_nobody_has_heard_of']) {
    assert.equal(channelFor(gate), 'queue', `expected ${gate} to route to queue`)
  }
})

test('AC-3: routing does not change when environment variables are set — it is a code-level table', async () => {
  const { channelFor } = await import(path.join(REPO, 'substrate', 'notify.js'))
  const prev = { ...process.env }
  try {
    process.env.NOTIFY_ROUTES = JSON.stringify({ spec_gate: 'phone' })
    process.env.NOTIFY_DRIVER = 'github'
    assert.equal(channelFor('spec_gate'), 'queue')
    assert.equal(channelFor('sev1_page'), 'phone')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k]
    Object.assign(process.env, prev)
  }
})
