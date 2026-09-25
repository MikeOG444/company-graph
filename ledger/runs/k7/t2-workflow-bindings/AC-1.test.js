// AC-1 (spec-wi-a5-agent-least-privilege): "every option object names an agentType — literally, or through
// the workflow's AT()/NEW() helper — and the test fails with the file and the site's label for any option
// object that names none, so a site reverting to the default workflow-subagent toolset is a red test."
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllWorkflows, extractSites } from './binding-helpers.js'

test('AC-1: every agent() option object across the nine workflows names an agentType', () => {
  const violations = []
  for (const { file, text } of readAllWorkflows()) {
    const sites = extractSites(text)
    assert.ok(sites.length > 0, `${file}: scanner found zero agent() call sites — check the scanner, not just the file`)
    for (const s of sites) {
      if (!s.bound) violations.push(`${file}: site '${s.label}' (schema ${s.schema}) names no agentType`)
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('AC-1: a site with no agentType is detected as a violation (scanner self-check)', () => {
  // A minimal fixture reproducing the unbound shape, independent of any real file, so this test does not
  // pass merely because every real site happens to be bound.
  const fixture = "const x = await agent(`do something`, { label: 'unbound-site', model: MODEL.cheap, schema: Thing })"
  const sites = extractSites(fixture)
  assert.equal(sites.length, 1)
  assert.equal(sites[0].bound, false)
})
