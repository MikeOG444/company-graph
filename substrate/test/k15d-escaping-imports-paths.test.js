// k15d: tests_ref arrives both absolute and relative (a Test Author returned an absolute one on k15), and the
// runner may report files either way. A mixed pair must not read every relative import as escaping.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText, extractBlock } from './extract-fixloop.js'
import { functionNamed, callSites } from './b5-wiring-helpers.js'

const { escapingImports } = new Function(extractBlock(readWorkflowText()).block + '\nreturn { escapingImports }')()
const ABS = '/home/user/company-graph/.artifacts/tests/t1'
const REL = '.artifacts/tests/t1'

test('mixed absolute/relative tests_ref and files: an import inside the TestSet never escapes', () => {
  for (const [ref, file] of [[ABS, `${REL}/x.test.js`], [REL, `${ABS}/x.test.js`], [`${ABS}/x.test.js`, `${REL}/x.test.js`], [ABS, `${ABS}/sub/y.js`]]) {
    assert.deepEqual(escapingImports({ tests_ref: ref, imports: [{ file, specifier: './helpers.js' }, { file, specifier: '../t1/z.js' }] }), [], `${ref} vs ${file}`)
  }
})

test('mixed forms: the k13 escape is still caught', () => {
  for (const [ref, file] of [[ABS, `${REL}/x.test.js`], [REL, `${ABS}/x.test.js`]]) {
    const out = escapingImports({ tests_ref: ref, imports: [{ file, specifier: '../../../substrate/test/helpers.js' }] })
    assert.equal(out.length, 1, `${ref} vs ${file}`)
  }
})

test('a non-default artifact_dir anchors the same way', () => {
  const out = escapingImports({ artifact_dir: 'build-art', tests_ref: '/x/build-art/tests/t1', imports: [
    { file: 'build-art/tests/t1/a.test.js', specifier: './h.js' },
    { file: 'build-art/tests/t1/a.test.js', specifier: '../../../substrate/test/helpers.js' }] })
  assert.deepEqual(out.map(o => o.specifier), ['../../../substrate/test/helpers.js'])
})

test('runTask passes the run artifact dir to escapingImports', () => {
  const text = readWorkflowText()
  const rt = functionNamed(text, 'runTask')
  const at = callSites(text, 'escapingImports', rt.bodyStart, rt.bodyEnd)[0]
  assert.ok(at)
  assert.match(text.slice(at, text.indexOf(')', at)), /artifact_dir:\s*ART/)
})
