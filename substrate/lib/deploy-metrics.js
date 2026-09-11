// Probe records → per-env metrics. Pure; the regression rule itself lives in the /deploy workflow script
// (an edge is code, and the verdict must be derived where the numbers cross), this only summarizes.
//
// record: { t, env, method, path, status (int | null), ms (number | null), error (string | undefined) }

export function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

export function summarize(records) {
  const envs = {}
  for (const r of records) {
    const e = envs[r.env] ??= { requests: 0, errors: 0, unreachable: 0, latencies: [], by_route: {} }
    const key = `${r.method} ${r.path}`
    const br = e.by_route[key] ??= { requests: 0, errors: 0, unreachable: 0, latencies: [] }
    e.requests++; br.requests++
    if (r.status === null || r.status === undefined) { e.unreachable++; br.unreachable++; continue }
    if (r.status >= 500) { e.errors++; br.errors++ }
    if (typeof r.ms === 'number') { e.latencies.push(r.ms); br.latencies.push(r.ms) }
  }
  const finish = (e) => {
    const s = [...e.latencies].sort((a, b) => a - b)
    return {
      requests: e.requests, errors: e.errors, unreachable: e.unreachable,
      error_rate: e.requests ? Math.round(((e.errors + e.unreachable) / e.requests) * 10000) / 10000 : 0,
      p50_ms: percentile(s, 50), p95_ms: percentile(s, 95),
    }
  }
  const out = {}
  for (const [env, e] of Object.entries(envs)) {
    out[env] = { ...finish(e), by_route: Object.fromEntries(Object.entries(e.by_route).map(([k, v]) => [k, finish(v)])) }
  }
  return out
}
