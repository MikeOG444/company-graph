import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cli, tmpRoot } from './helpers.js'

test('write by stdin and --from, read by ref, ls, refuse escape', () => {
  const root = tmpRoot()
  const w = cli('artifacts', ['write', 'diffs', 't1.r0.patch'], { root, input: '--- a\n+++ b\n' })
  assert.equal(w.code, 0, w.err)
  assert.equal(w.out, '.artifacts/diffs/t1.r0.patch')
  assert.equal(cli('artifacts', ['read', w.out], { root }).out, '--- a\n+++ b')

  const src = path.join(root, 'res.json'); fs.writeFileSync(src, '{"passed":1}')
  assert.equal(cli('artifacts', ['write', 'results', 't1.r1.json', '--from', src], { root }).out, '.artifacts/results/t1.r1.json')
  assert.deepEqual(cli('artifacts', ['ls'], { root }).out.split('\n').sort(), ['.artifacts/diffs/t1.r0.patch', '.artifacts/results/t1.r1.json'])

  assert.equal(cli('artifacts', ['write', 'nope', 'x'], { root }).code, 2)
  assert.equal(cli('artifacts', ['write', 'diffs', '../../etc/passwd'], { root }).code, 2)
  assert.equal(cli('artifacts', ['read', '../outside'], { root }).code, 2)
  assert.equal(cli('artifacts', ['read', '.artifacts/diffs/missing'], { root }).code, 1)
})
