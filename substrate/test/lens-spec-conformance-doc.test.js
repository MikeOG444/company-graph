// AC-16: lens-spec-conformance.md must require a repository-relative path:line
// location (load-bearing for the diff slicer) and allow the lens to be re-panelled
// alone, while its pre-existing rules stay present and unaltered. Written from the
// spec only. Lands in substrate/test/ and runs under the repo's `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { LENS_SPEC_CONFORMANCE_MD_PATH } from './extract-fixloop.js'

test('AC-16: lens-spec-conformance.md documents the path:line location rule and solo re-panelling, without dropping its existing rules', () => {
  const text = fs.readFileSync(LENS_SPEC_CONFORMANCE_MD_PATH, 'utf8')

  // New: location must be a repository-relative path with a line number.
  assert.match(text, /repository[- ]relative/i, 'must state location is repository-relative')
  assert.match(text, /line/i, 'must require a line number in location')

  // New: the lens may be re-panelled alone and must judge the whole diff.
  assert.match(text, /re-?panel(l)?ed?\s+alone/i, 'must state the lens may be re-panelled alone')
  assert.match(text, /whole diff|entire diff|whole change set|entire change set/i, 'must state it judges the whole diff, not only the fix')

  // Existing rules must still be present and unaltered.
  assert.match(text, /reject/i, 'reject-by-default rule must still be present')
  assert.match(text, /attempts/i, 'the attempts rule must still be present')
  assert.match(text, /three|3/i, 'the "at least three attempts" rule must still be present')
  assert.match(text, /touched_surfaces/, 'touched_surfaces as a permission envelope must still be present')
  assert.match(text, /test/i, 'the "tests written elsewhere" rule must still be present')
  assert.match(text, /dedupe_key/, 'the dedupe_key format rule must still be present')
})
