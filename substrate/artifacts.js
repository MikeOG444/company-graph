#!/usr/bin/env node
// Artifact store under .artifacts/. Refs are repo-relative paths: ".artifacts/<kind>/<name>".
//   artifacts write <kind> <name> [--from <file>]   (content from --from or stdin) → prints the ref
//   artifacts read  <ref>                            → prints content
//   artifacts path  <ref>                            → prints absolute path
//   artifacts ls    [kind]                           → lists refs
//   artifacts kinds
import fs from 'node:fs'
import path from 'node:path'
import { ARTIFACTS, ensureDir, refToAbs, absToRef, parseArgs, die } from './lib/paths.js'

export const KINDS = ['diffs', 'tests', 'results', 'worktrees', 'integration', 'traces', 'misc']

const { pos, opts } = parseArgs(process.argv.slice(2))
const [cmd, a, b] = pos

function checkName(name) {
  if (!name || name.includes('..') || path.isAbsolute(name)) die(`bad artifact name: ${name}`)
}

try { switch (cmd) {
  case 'kinds': console.log(KINDS.join('\n')); break

  case 'write': {
    const kind = a, name = b
    if (!KINDS.includes(kind)) die(`unknown kind "${kind}". Kinds: ${KINDS.join(', ')}`)
    checkName(name)
    const content = opts.from ? fs.readFileSync(opts.from) : fs.readFileSync(0)
    const abs = path.join(ARTIFACTS, kind, name)
    ensureDir(path.dirname(abs))
    fs.writeFileSync(abs, content)
    console.log(absToRef(abs))
    break
  }

  case 'read': {
    if (!a) die('usage: artifacts read <ref>')
    const abs = refToAbs(a)
    if (!fs.existsSync(abs)) die(`no such artifact: ${a}`, 1)
    process.stdout.write(fs.readFileSync(abs))
    break
  }

  case 'path': {
    if (!a) die('usage: artifacts path <ref>')
    console.log(refToAbs(a))
    break
  }

  case 'ls': {
    const kinds = a ? [a] : KINDS
    for (const k of kinds) {
      const dir = path.join(ARTIFACTS, k)
      if (!fs.existsSync(dir)) continue
      const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? (k === 'worktrees' ? [path.join(d, e.name)] : walk(path.join(d, e.name))) : [path.join(d, e.name)])
      for (const f of walk(dir)) console.log(absToRef(f))
    }
    break
  }

  default:
    die('usage: artifacts write <kind> <name> [--from file] | read <ref> | path <ref> | ls [kind] | kinds')
} } catch (e) { die(e.message) }
