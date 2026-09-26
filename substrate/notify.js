// Best-effort, non-blocking notification for gates. Never throws, never rejects, never fails the caller.
//
// Routing: a code-level table decides the channel for a gate name (see channelFor). The driver that actually
// sends is chosen by env var NOTIFY_DRIVER ("github" | "webhook"; unset = no driver, delivery.attempted = false).
//
// Env vars:
//   NOTIFY_DRIVER          "github" | "webhook" (unset = no driver configured)
//   NOTIFY_GITHUB_TOKEN    token for the GitHub REST API (Authorization header only; never logged or written)
//   NOTIFY_GITHUB_REPO     "owner/repo" to open the issue in
//   NOTIFY_GITHUB_API      base URL override, default https://api.github.com (tests point this at 127.0.0.1)
//   NOTIFY_WEBHOOK_URL     URL the webhook driver POSTs to (UNVERIFIED FROM CI — see substrate/README.md)
//   NOTIFY_TIMEOUT_MS      per-attempt timeout in ms, default 5000
//
// GITHUB_TOKEN is never read; only NOTIFY_GITHUB_TOKEN selects the token.

// Budget-breach gate names route to the phone channel, same as sev1_page. Everything else, including spec_gate,
// goes to queue. This table is a literal in code, not read from env or config.
const PHONE_GATES = new Set(['sev1_page', 'ratio_gate'])

export function channelFor(gateName) {
  const name = String(gateName || '')
  if (PHONE_GATES.has(name) || name.endsWith('_budget_breach')) return 'phone'
  return 'queue'
}

function timeoutMs(env) {
  const raw = env.NOTIFY_TIMEOUT_MS
  const n = raw === undefined ? 5000 : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 5000
}

async function fetchWithTimeout(url, init, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Verified driver: opens a labelled GitHub issue via the REST API. The only transport reachable from this
// container (see substrate/README.md for the egress policy that rules out the alternatives).
const githubDriver = {
  name: 'github',
  async send(record, channel, env) {
    const token = env.NOTIFY_GITHUB_TOKEN
    const repo = env.NOTIFY_GITHUB_REPO
    if (!token || !repo) throw new Error('github driver not configured: missing NOTIFY_GITHUB_TOKEN or NOTIFY_GITHUB_REPO')
    const base = env.NOTIFY_GITHUB_API || 'https://api.github.com'
    const url = `${base.replace(/\/+$/, '')}/repos/${repo}/issues`
    const title = `[gate:${channel}] ${record.gate} (${record.id})`
    const body = [
      `Gate \`${record.id}\` (${record.gate}) opened by workflow \`${record.workflow}\` in run \`${record.run_id}\`.`,
      `Record: gates/open/${record.id}.json`,
      `Options: ${(record.options || []).join(', ')}`,
    ].join('\n')
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'company-graph-notify',
      },
      body: JSON.stringify({ title, body, labels: ['gate', `channel:${channel}`] }),
    }, timeoutMs(env))
    if (!res.ok) {
      // Never include the response body in the error: a server that echoes the request back (e.g. a 401 that
      // reflects the Authorization header) must not leak the token into delivery.error, stdout or stderr.
      throw new Error(`github issue create failed: HTTP ${res.status}`)
    }
    return { ok: true }
  },
}

// Optional generic webhook driver. UNVERIFIED FROM CI: no test in this repo exercises it against a real external
// service, only against a local 127.0.0.1 stand-in (see substrate/README.md).
const webhookDriver = {
  name: 'webhook',
  async send(record, channel, env) {
    const url = env.NOTIFY_WEBHOOK_URL
    if (!url) throw new Error('webhook driver not configured: missing NOTIFY_WEBHOOK_URL')
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gate: record.gate,
        id: record.id,
        channel,
        run_id: record.run_id,
        workflow: record.workflow,
        record_path: `gates/open/${record.id}.json`,
      }),
    }, timeoutMs(env))
    if (!res.ok) throw new Error(`webhook post failed: ${res.status}`)
    return { ok: true }
  },
}

const DRIVERS = { github: githubDriver, webhook: webhookDriver }

function safeErrorMessage(err) {
  const msg = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || String(err)
  return msg || 'unknown error'
}

// Never rejects. Returns a delivery object: {attempted, ok, channel, at, error?}.
export async function notify(record, { env = process.env, driver } = {}) {
  const channel = channelFor(record.gate)
  const at = new Date().toISOString()
  const chosen = driver || DRIVERS[env.NOTIFY_DRIVER]
  if (!chosen) {
    return { attempted: false, ok: false, channel, at, error: 'delivery not configured: no NOTIFY_DRIVER selected' }
  }
  try {
    await chosen.send(record, channel, env)
    return { attempted: true, ok: true, channel, at }
  } catch (err) {
    return { attempted: true, ok: false, channel, at, error: safeErrorMessage(err) }
  }
}
