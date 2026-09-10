// Resolves the repo root and the three substrate directories.
// Root = nearest ancestor of cwd containing contracts.schema.json, or $COMPANY_GRAPH_ROOT.
import fs from 'node:fs'
import path from 'node:path'

export function findRoot(start = process.cwd()) {
  if (process.env.COMPANY_GRAPH_ROOT) return path.resolve(process.env.COMPANY_GRAPH_ROOT)
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'contracts.schema.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('company-graph root not found (no contracts.schema.json above cwd; set COMPANY_GRAPH_ROOT)')
    dir = parent
  }
}

export const ROOT = findRoot()
export const SCHEMA_PATH = path.join(ROOT, 'contracts.schema.json')
export const ARTIFACTS = path.join(ROOT, '.artifacts')
export const GATES = path.join(ROOT, 'gates')
export const LEDGER = path.join(ROOT, 'ledger')

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p }

// A ref is always a repo-relative POSIX path. Refuse anything that escapes the root.
export function refToAbs(ref) {
  const abs = path.resolve(ROOT, ref)
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) throw new Error(`ref escapes repo root: ${ref}`)
  return abs
}
export function absToRef(abs) { return path.relative(ROOT, abs).split(path.sep).join('/') }

export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }
export function writeJson(p, obj) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n') }

export function nowIso(override) {
  if (override) {
    if (Number.isNaN(Date.parse(override))) throw new Error(`bad --now timestamp: ${override}`)
    return new Date(override).toISOString()
  }
  return new Date().toISOString()
}

// Tiny argv parser: positionals + --key value / --flag. Enough for the four CLIs.
export function parseArgs(argv) {
  const pos = [], opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) opts[k] = true
      else { opts[k] = next; i++ }
    } else pos.push(a)
  }
  return { pos, opts }
}

export function die(msg, code = 2) { process.stderr.write(msg + '\n'); process.exit(code) }
