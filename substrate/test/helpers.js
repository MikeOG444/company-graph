import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
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
