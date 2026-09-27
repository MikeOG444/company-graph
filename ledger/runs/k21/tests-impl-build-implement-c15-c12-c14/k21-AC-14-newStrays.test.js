// spec-wi-c15-c12-c14-line-guards AC-14. Written from the Spec only.
//
// "newStrays from the extracted block ... called with reported ['.artifacts/results/t1.r1.json',
// 'stray.js', 'notes/x.md', 'pre.txt'], baseline ['pre.txt'], artifact_dir '.artifacts' ... returns
// ['stray.js', 'notes/x.md'] in reported order. A path equal to the artifact dir, or starting with
// '<artifact_dir>/', is excluded. A path that only shares the prefix text (e.g. '.artifactsX/a') is NOT
// excluded. A missing or empty reported list returns []. A missing baseline is treated as []."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAllFixLoopFunctions } from './extract-fixloop.js'

test('AC-14: newStrays excludes artifact-dir paths and baseline paths, in reported order', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.newStrays({
    reported: ['.artifacts/results/t1.r1.json', 'stray.js', 'notes/x.md', 'pre.txt'],
    baseline: ['pre.txt'],
    artifact_dir: '.artifacts',
  })
  assert.deepEqual(result, ['stray.js', 'notes/x.md'])
})

test('AC-14: a path exactly equal to the artifact dir is excluded', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.newStrays({ reported: ['.artifacts', 'stray.js'], baseline: [], artifact_dir: '.artifacts' })
  assert.deepEqual(result, ['stray.js'])
})

test('AC-14: a path that only shares the artifact dir\'s prefix text (not a real subpath) is NOT excluded', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.newStrays({ reported: ['.artifactsX/a', 'stray.js'], baseline: [], artifact_dir: '.artifacts' })
  assert.deepEqual(result, ['.artifactsX/a', 'stray.js'])
})

test('AC-14: a missing or empty reported list returns []', () => {
  const { fns } = loadAllFixLoopFunctions()
  assert.deepEqual(fns.newStrays({ reported: undefined, baseline: [], artifact_dir: '.artifacts' }), [])
  assert.deepEqual(fns.newStrays({ reported: [], baseline: [], artifact_dir: '.artifacts' }), [])
})

test('AC-14: a missing baseline is treated as []', () => {
  const { fns } = loadAllFixLoopFunctions()
  const result = fns.newStrays({ reported: ['a.txt'], baseline: undefined, artifact_dir: '.artifacts' })
  assert.deepEqual(result, ['a.txt'])
})
