#!/usr/bin/env node
// Local deploy target for Launch (OPERATING_MODEL §7). One env = one port on 127.0.0.1, one detached process, one
// worktree of THIS repository pinned at a sha. It exists so /deploy's Deployer, Post-launch Watch and rollback are
// deterministic shell steps a mechanical agent can run verbatim; every judgment (healthy vs regressed) stays in the
// workflow script, which only ever sees the numbers this prints.
//
//   deploy checkout --project <id> --env <name> --ref <git ref> --app <dir>
//       worktree at .artifacts/deploy/<project>/<env>/ detached at <ref> (replaced if it is at another sha);
//       npm ci in <worktree>/<app>. Prints { worktree, sha }.
//   deploy start    --project <id> --env <name> --port <n> --app <dir> [--ref <git ref>] [--health /health] [--now iso]
//       (checkout first when --ref is given) start the app's `npm start` command with PORT=<n>, detached, log to
//       .artifacts/deploy/<project>/<env>.log; wait for 2xx on the health path. Prints a Deployment (contracts.schema.json).
//       Idempotent: already running at the same sha and healthy → prints the existing record.
//   deploy stop     --project <id> --env <name> [--now iso]
//   deploy status   --project <id> [--env <name>]          prints Deployment(s) with a live health check
//   deploy probe    --project <id> --canary <env> [--baseline <env>] --seconds <n> --out <ref>
//                   [--interval-ms 250] [--routes '<json array>'] [--timeout-ms 2000]
//       hits every route on both envs round-robin for <n> seconds; raw records to <ref> (JSONL); prints the per-env
//       summary { requests, errors (5xx), unreachable, error_rate, p50_ms, p95_ms, by_route }.
//   deploy promote  --project <id> --from <env> --to <env> --port <n> --app <dir> [--now iso]
//       start <to> at <from>'s sha (stopping the old <to> first), then stop <from>. Prints the new <to> Deployment.
//   deploy remove   --project <id> --env <name>            stop + drop the worktree
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { ROOT, ARTIFACTS, ensureDir, absToRef, refToAbs, parseArgs, die, readJson, writeJson, nowIso } from './lib/paths.js'
import { validate, formatErrors } from './lib/contracts.js'
import { summarize } from './lib/deploy-metrics.js'

const { pos, opts } = parseArgs(process.argv.slice(2))
const [cmd] = pos
const need = (...ks) => { for (const k of ks) if (opts[k] === undefined || opts[k] === true) die(`--${k} is required (see header of substrate/deploy.js)`) }
const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_')

const dir = (project) => path.join(ARTIFACTS, 'deploy', safe(project))
const recPath = (project, env) => path.join(dir(project), `${safe(env)}.json`)
const readRec = (project, env) => fs.existsSync(recPath(project, env)) ? readJson(recPath(project, env)) : null
function writeRec(rec) {
  const v = validate('Deployment', rec)
  if (!v.ok) die(`Deployment invalid:\n${formatErrors(v.errors)}`)
  writeJson(recPath(rec.project_id, rec.env), rec)
  // status page: every env, one file (Workspace.comms.status_page)
  const all = fs.readdirSync(dir(rec.project_id)).filter(f => f.endsWith('.json') && f !== 'status.json').map(f => readJson(path.join(dir(rec.project_id), f)))
  writeJson(path.join(dir(rec.project_id), 'status.json'), { project_id: rec.project_id, updated_at: rec.stopped_at ?? rec.started_at, envs: all })
  return rec
}

function git(args, cwd = ROOT) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return r.stdout.trim()
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function health(url, healthPath, timeoutMs = 1500) {
  try {
    const r = await fetch(url + healthPath, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch { return false }
}

function checkout(project, env, ref, app) {
  const wt = path.join(dir(project), safe(env))
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`])
  if (fs.existsSync(wt)) {
    let at = null
    try { at = git(['rev-parse', 'HEAD'], wt) } catch {}
    if (at !== sha) {
      try { git(['worktree', 'remove', '--force', wt]) } catch { fs.rmSync(wt, { recursive: true, force: true }) }
      git(['worktree', 'prune'])
    }
  }
  if (!fs.existsSync(wt)) { ensureDir(path.dirname(wt)); git(['worktree', 'add', '--detach', wt, sha]) }
  const appDir = path.join(wt, app)
  if (!fs.existsSync(path.join(appDir, 'package.json'))) die(`no package.json at ${absToRef(appDir)}`)
  if (fs.existsSync(path.join(appDir, 'package-lock.json')) && !fs.existsSync(path.join(appDir, 'node_modules'))) {
    const r = spawnSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], { cwd: appDir, encoding: 'utf8' })
    if (r.status !== 0) die(`npm ci failed in ${absToRef(appDir)}:\n${r.stderr}`)
  }
  return { worktree: absToRef(wt), sha, app_dir: absToRef(appDir) }
}

async function stop(project, env, now) {
  const rec = readRec(project, env)
  if (!rec) return null
  if (rec.status === 'running' && alive(rec.pid)) {
    try { process.kill(-rec.pid, 'SIGTERM') } catch { try { process.kill(rec.pid, 'SIGTERM') } catch {} }
    for (let i = 0; i < 40 && alive(rec.pid); i++) await sleep(100)
    if (alive(rec.pid)) { try { process.kill(-rec.pid, 'SIGKILL') } catch {} }
  }
  return writeRec({ ...rec, status: 'stopped', stopped_at: nowIso(now) })
}

async function start(project, env, port, app, ref, healthPath, now) {
  const existing = readRec(project, env)
  let co
  if (ref) co = checkout(project, env, ref, app)
  else {
    const wt = path.join(dir(project), safe(env))
    if (!fs.existsSync(wt)) die(`nothing checked out for ${project}/${env}; pass --ref`)
    co = { worktree: absToRef(wt), sha: git(['rev-parse', 'HEAD'], wt), app_dir: absToRef(path.join(wt, app)) }
  }
  const url = `http://127.0.0.1:${port}`
  if (existing?.status === 'running' && alive(existing.pid) && existing.sha === co.sha && existing.port === Number(port) && await health(url, healthPath)) {
    console.log(JSON.stringify(existing)); return existing
  }
  if (existing?.status === 'running') await stop(project, env, now)

  const appDir = refToAbs(co.app_dir)
  const pkg = readJson(path.join(appDir, 'package.json'))
  const startCmd = pkg.scripts?.start
  if (!startCmd) die(`${co.app_dir}/package.json has no "start" script`)
  const logAbs = path.join(dir(project), `${safe(env)}.log`)
  ensureDir(dir(project))
  const out = fs.openSync(logAbs, 'a')
  const child = spawn('sh', ['-c', startCmd], {
    cwd: appDir, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
  })
  child.unref()
  const rec = {
    project_id: project, env, url, port: Number(port), ref: ref ?? existing?.ref ?? co.sha, sha: co.sha,
    worktree: co.worktree, app_dir: co.app_dir, pid: child.pid, started_at: nowIso(now), log_ref: absToRef(logAbs), status: 'running',
  }
  const deadline = Date.now() + 20000
  let ok = false
  while (Date.now() < deadline) {
    if (!alive(child.pid)) break
    if (await health(url, healthPath)) { ok = true; break }
    await sleep(250)
  }
  if (!ok) {
    try { process.kill(-child.pid, 'SIGKILL') } catch {}
    writeRec({ ...rec, status: 'failed', stopped_at: nowIso(now) })
    const tail = fs.existsSync(logAbs) ? fs.readFileSync(logAbs, 'utf8').split('\n').slice(-15).join('\n') : ''
    die(`${project}/${env} did not answer 2xx on ${healthPath} within 20s. Log tail:\n${tail}`, 1)
  }
  writeRec(rec)
  console.log(JSON.stringify(rec))
  return rec
}

const DEFAULT_ROUTES = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/items' },
  { method: 'POST', path: '/items', body: { name: 'probe' } },
  { method: 'GET', path: '/items/1' },
  { method: 'GET', path: '/items?sort=name&limit=2' },
]

async function probe(project, canary, baseline, seconds, outRef, intervalMs, routes, timeoutMs) {
  const envs = [['canary', readRec(project, canary)], ['baseline', baseline ? readRec(project, baseline) : null]]
    .filter(([, r]) => r).map(([role, r]) => ({ role, url: r.url }))
  if (!envs.length) die(`no deployment records for ${project}/${canary}`)
  const outAbs = refToAbs(outRef); ensureDir(path.dirname(outAbs))
  const fd = fs.openSync(outAbs, 'a')
  const records = []
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    for (const route of routes) {
      for (const e of envs) {
        const t0 = process.hrtime.bigint()
        let status = null, error
        try {
          const r = await fetch(e.url + route.path, {
            method: route.method, signal: AbortSignal.timeout(timeoutMs),
            headers: route.body ? { 'content-type': 'application/json' } : undefined,
            body: route.body ? JSON.stringify(route.body) : undefined,
          })
          status = r.status; await r.arrayBuffer()
        } catch (err) { error = String(err?.cause?.code ?? err?.name ?? err) }
        const ms = Number(process.hrtime.bigint() - t0) / 1e6
        const rec = { t: new Date().toISOString(), env: e.role, method: route.method, path: route.path, status, ms: status === null ? null : Math.round(ms * 100) / 100, error }
        records.push(rec); fs.writeSync(fd, JSON.stringify(rec) + '\n')
      }
    }
    await sleep(intervalMs)
  }
  fs.closeSync(fd)
  const summary = { project_id: project, seconds, raw_ref: outRef, ...summarize(records) }
  writeJson(outAbs.replace(/\.jsonl$/, '') + '.summary.json', summary)
  console.log(JSON.stringify(summary))
}

try { switch (cmd) {
  case 'checkout': { need('project', 'env', 'ref', 'app'); console.log(JSON.stringify(checkout(opts.project, opts.env, opts.ref, opts.app))); break }
  case 'start': { need('project', 'env', 'port', 'app'); await start(opts.project, opts.env, opts.port, opts.app, opts.ref, opts.health ?? '/health', opts.now); break }
  case 'stop': { need('project', 'env'); const r = await stop(opts.project, opts.env, opts.now); console.log(r ? JSON.stringify(r) : `nothing recorded for ${opts.project}/${opts.env}`); break }
  case 'status': {
    need('project')
    const envs = opts.env ? [opts.env] : (fs.existsSync(dir(opts.project)) ? fs.readdirSync(dir(opts.project)).filter(f => f.endsWith('.json') && f !== 'status.json').map(f => f.replace(/\.json$/, '')) : [])
    const out = []
    for (const env of envs) {
      const r = readRec(opts.project, env); if (!r) continue
      const running = r.status === 'running' && alive(r.pid)
      out.push({ ...r, alive: running, healthy: running ? await health(r.url, opts.health ?? '/health') : false })
    }
    console.log(JSON.stringify(opts.env ? (out[0] ?? null) : out)); break
  }
  case 'probe': {
    need('project', 'canary', 'seconds', 'out')
    const routes = opts.routes && opts.routes !== true ? JSON.parse(opts.routes) : DEFAULT_ROUTES
    await probe(opts.project, opts.canary, opts.baseline, Number(opts.seconds), opts.out, Number(opts['interval-ms'] ?? 250), routes, Number(opts['timeout-ms'] ?? 2000)); break
  }
  case 'promote': {
    need('project', 'from', 'to', 'port', 'app')
    const from = readRec(opts.project, opts.from)
    if (!from || from.status !== 'running') die(`${opts.project}/${opts.from} is not running`, 1)
    await stop(opts.project, opts.to, opts.now)
    await start(opts.project, opts.to, opts.port, opts.app, from.sha, opts.health ?? '/health', opts.now)
    await stop(opts.project, opts.from, opts.now)
    break
  }
  case 'remove': {
    need('project', 'env')
    await stop(opts.project, opts.env, opts.now)
    const wt = path.join(dir(opts.project), safe(opts.env))
    if (fs.existsSync(wt)) { try { git(['worktree', 'remove', '--force', wt]) } catch { fs.rmSync(wt, { recursive: true, force: true }) } git(['worktree', 'prune']) }
    console.log(`removed ${opts.project}/${opts.env}`); break
  }
  default: die('usage: deploy checkout|start|stop|status|probe|promote|remove ...  (see header of substrate/deploy.js)')
} } catch (e) { die(e.message ?? String(e)) }
