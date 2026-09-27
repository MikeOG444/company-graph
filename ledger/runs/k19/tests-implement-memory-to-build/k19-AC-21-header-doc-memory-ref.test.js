// spec-wi-b1-b2-memory-to-build AC-21. Written from the Spec only.
//
// "the header args comments of build-spec.js and build-implement.js" / "read" / "each documents
// memory_ref? as optional, including its meaning and its silent-degradation behavior"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText as readImplementText } from './extract-fixloop.js'
import { readWorkflowText as readSpecText } from './k19-patterns-extract-helpers.js'

// The leading header comment block: from the top of the file through the line introducing the `const A =
// args` binding (every workflow in this repo follows that shape — see build-spec.js's and
// build-implement.js's own "// args: {" comments already in the header today).
function headerComment(text) {
  const idx = text.indexOf('const A = args')
  assert.ok(idx !== -1, 'expected a `const A = args` binding to anchor the end of the header comment')
  return text.slice(0, idx)
}

for (const [name, reader] of [['build-spec.js', readSpecText], ['build-implement.js', readImplementText]]) {
  test(`AC-21: ${name}'s header args comment documents memory_ref? as optional, with its meaning and silent-degradation behavior`, () => {
    const header = headerComment(reader())
    assert.match(header, /memory_ref\s*\?/, `${name} header must document memory_ref as optional (memory_ref?)`)
    assert.match(header, /memory_ref[\s\S]{0,400}/i) // sanity: memory_ref is mentioned at all (redundant with above, kept for a clearer failure message)
    const mentionsRepoRelativePath = /repository-relative|repo-relative/i.test(header)
    const mentionsDegradation = /(missing|unreadable|empty|malformed)[\s\S]{0,200}(degrad|unchanged|identical|silently|silent)/i.test(header)
      || /(degrad|silently|silent)[\s\S]{0,200}(missing|unreadable|empty|malformed)/i.test(header)
    assert.ok(mentionsRepoRelativePath, `${name} header must document what memory_ref points to (a repository-relative path)`)
    assert.ok(mentionsDegradation, `${name} header must document silent degradation when memory_ref is missing/unreadable/empty/malformed`)
  })
}
