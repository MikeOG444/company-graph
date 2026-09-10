#!/usr/bin/env node
// validator <Def> <file.json | ->   → exit 0 if valid, 1 if invalid, 2 on usage error.
import fs from 'node:fs'
import { validate, listDefs, formatErrors } from './lib/contracts.js'
import { parseArgs, die } from './lib/paths.js'

const { pos, opts } = parseArgs(process.argv.slice(2))
if (opts.list) { console.log(listDefs().join('\n')); process.exit(0) }
const [def, file] = pos
if (!def || !file) die('usage: validator <Def> <file.json | ->\n       validator --list')

let obj
try {
  const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8')
  obj = JSON.parse(text)
} catch (e) { die(`cannot read JSON from ${file}: ${e.message}`) }

let result
try { result = validate(def, obj) } catch (e) { die(e.message) }

if (result.ok) { console.log(`OK ${def} ${file}`); process.exit(0) }
console.log(`INVALID ${def} ${file} (${result.errors.length} error${result.errors.length === 1 ? '' : 's'})`)
console.log(formatErrors(result.errors))
process.exit(1)
