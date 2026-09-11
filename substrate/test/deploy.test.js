import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, REPO } from './helpers.js'
import { summarize, percentile } from '../lib/deploy-metrics.js'

test('summarize: 5xx and unreachable both count as errors; latency percentiles over answered requests', () => {
  const recs = [
    { env: 'canary', method: 'GET', path: '/a', status: 200, ms: 1 },
    { env: 'canary', method: 'GET', path: '/a', status: 500, ms: 3 },
    { env: 'canary', method: 'GET', path: '/b', status: null, ms: null, error: 'ECONNREFUSED' },
    { env: 'canary', method: 'GET', path: '/b', status: 404, ms: 2 },
    { env: 'baseline', method: 'GET', path: '/a', status: 200, ms: 5 },
  ]
  const s = summarize(recs)
  assert.equal(s.canary.requests, 4)
  assert.equal(s.canary.errors, 1)
  assert.equal(s.canary.unreachable, 1)
  assert.equal(s.canary.error_rate, 0.5)
  assert.equal(s.canary.p50_ms, 2)
  assert.equal(s.canary.p95_ms, 3)
  assert.equal(s.canary.by_route['GET /b'].unreachable, 1)
  assert.equal(s.baseline.error_rate, 0)
  assert.equal(percentile([], 50), null)
})

// Real round trip on the toy: worktree at HEAD, detached process on a port, probe, stop. Uses the repo's own
// .artifacts/deploy/<project>/ under a throwaway project id so it never collides with a live launch.
test('deploy start → status → probe → stop on the toy', async () => {
  const project = `cgtest-${process.pid}`
  const port = 3900 + (process.pid % 100)
  try {
    const st = cli('deploy', ['start', '--project', project, '--env', 'prod', '--port', String(port), '--app', 'toy', '--ref', 'HEAD', '--now', '2026-09-11T00:00:00Z'])
    assert.equal(st.code, 0, st.err)
    const rec = JSON.parse(st.out)
    assert.equal(rec.status, 'running')
    assert.equal(rec.url, `http://127.0.0.1:${port}`)
    assert.match(rec.sha, /^[0-9a-f]{40}$/)
    assert.equal(cli('validator', ['Deployment', path.join(REPO, '.artifacts', 'deploy', project, 'prod.json')]).code, 0)

    const status = JSON.parse(cli('deploy', ['status', '--project', project, '--env', 'prod']).out)
    assert.equal(status.alive, true)
    assert.equal(status.healthy, true)

    // idempotent: same sha, same port, healthy → same record, no restart
    const again = JSON.parse(cli('deploy', ['start', '--project', project, '--env', 'prod', '--port', String(port), '--app', 'toy', '--ref', 'HEAD']).out)
    assert.equal(again.pid, rec.pid)

    const out = `.artifacts/deploy/${project}/watch/t.jsonl`
    const pr = cli('deploy', ['probe', '--project', project, '--canary', 'prod', '--seconds', '2', '--out', out, '--interval-ms', '50'])
    assert.equal(pr.code, 0, pr.err)
    const sum = JSON.parse(pr.out)
    assert.ok(sum.canary.requests >= 5, `only ${sum.canary.requests} probes`)
    assert.equal(sum.canary.error_rate, 0)
    assert.ok(fs.existsSync(path.join(REPO, out)))
    assert.ok(fs.existsSync(path.join(REPO, `.artifacts/deploy/${project}/watch/t.summary.json`)))

    const sp = cli('deploy', ['stop', '--project', project, '--env', 'prod'])
    assert.equal(sp.code, 0, sp.err)
    assert.equal(JSON.parse(sp.out).status, 'stopped')
    const after = JSON.parse(cli('deploy', ['status', '--project', project, '--env', 'prod']).out)
    assert.equal(after.alive, false)
  } finally {
    cli('deploy', ['remove', '--project', project, '--env', 'prod'])
    fs.rmSync(path.join(REPO, '.artifacts', 'deploy', project), { recursive: true, force: true })
  }
})
