// Local, 127.0.0.1-only HTTP server helpers for the notify.js driver tests (spec-wi-c5-gate-delivery).
// No test in this directory makes a real network call: every server here binds 127.0.0.1 on an
// OS-assigned port (port 0), and every driver under test is pointed at that bound address through the
// NOTIFY_GITHUB_API / NOTIFY_WEBHOOK_URL env vars pinned by the Spec's INTERFACE section.
import http from 'node:http'

// Starts a server; `respond(req, res, entry)` decides how to answer. Returns { url, requests, close }.
// `requests` accumulates one entry per request received: { method, url, headers, body (parsed JSON if
// possible, else raw text) }.
export function startServer(respond) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body
      try { body = raw ? JSON.parse(raw) : undefined } catch { body = raw }
      const entry = { method: req.method, url: req.url, headers: req.headers, body }
      requests.push(entry)
      respond(req, res, entry)
    })
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise(r => server.close(() => r())),
      })
    })
  })
}

// Answers every request with `status` and a JSON body (or the result of calling bodyFn(entry)).
export function jsonResponder(status, bodyOrFn) {
  return (req, res, entry) => {
    const body = typeof bodyOrFn === 'function' ? bodyOrFn(entry) : bodyOrFn
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? {}))
  }
}

// Accepts the connection but never writes a response — for exercising the notifier's own timeout.
export function hangResponder() {
  return () => {}
}

// A URL nothing is listening on (127.0.0.1, a port that was briefly bound then released), for exercising
// a connection-refused failure without ever reaching a real host.
export async function closedPortUrl() {
  const s = await startServer(jsonResponder(200, {}))
  const { url } = s
  await s.close()
  return url
}
