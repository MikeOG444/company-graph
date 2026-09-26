import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Repository root: walk up from process.cwd() to the repo markers, falling back to this file's own directory
// (C10, k13d). Counting '..' from this file made cli() run whichever gates.js sat two levels above the helper —
// on k13 the MAIN checkout's, not the task worktree's — so every CLI test exercised the pre-task code.
function findRepoRoot(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'contracts.schema.json')) && fs.existsSync(path.join(dir, 'COMPANY.md'))) return dir
    if (path.dirname(dir) === dir) return null
  }
}
export const REPO = findRepoRoot(process.cwd()) ?? findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
if (!REPO) throw new Error(`repository root not found above ${process.cwd()}`)
export const FIX = path.join(REPO, 'substrate', 'test', 'fixtures')

// A throwaway root with a copy of the schema, so gates/ and ledger/ writes never touch the real repo.
export function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'))
  fs.copyFileSync(path.join(REPO, 'contracts.schema.json'), path.join(dir, 'contracts.schema.json'))
  return dir
}

export function cli(name, args, { root, input } = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'substrate', `${name}.js`), ...args], {
    cwd: root ?? REPO, input, encoding: 'utf8',
    env: { ...process.env, COMPANY_GRAPH_ROOT: root ?? REPO },
  })
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}
