// Async twin of helpers.js cli(), for the C5 notifier tests (k13d). helpers.js cli() uses spawnSync, which
// blocks THIS process's event loop — and the fake GitHub server these tests start lives in this process, so
// the child's POST could never be answered: every "successful" delivery timed out, and failure-path tests
// passed for the wrong reason. Same contract as cli(): { code, out, err }.
import path from 'node:path'
import { spawn } from 'node:child_process'
import { REPO } from './helpers.js'

// killAfterMs: a child still running then is killed and resolves with code null, so a hung CLI FAILS the
// test instead of hanging the whole suite (a timeout mutation otherwise went undetected, k13d).
export function cliAsync(name, args, { root, input, killAfterMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO, 'substrate', `${name}.js`), ...args], {
      cwd: root ?? REPO, env: { ...process.env, COMPANY_GRAPH_ROOT: root ?? REPO },
    })
    let out = '', err = ''
    const killer = setTimeout(() => child.kill('SIGKILL'), killAfterMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => { clearTimeout(killer); resolve({ code, out: out.trim(), err: err.trim() }) })
    if (input != null) child.stdin.end(input); else child.stdin.end()
  })
}
