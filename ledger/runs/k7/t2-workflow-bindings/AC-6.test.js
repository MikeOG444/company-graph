// AC-6 (spec-wi-a5-agent-least-privilege): "each call site's model option and its bound definition's
// frontmatter model ... the test maps MODEL.strong/mid/cheap to opus/sonnet/haiku and compares them ... the
// two agree at every site, so no binding silently re-tiers a node — in particular integrate:resolve is
// bound to a strong-tier write-capable definition rather than to the haiku-tier 'mechanical' type."
import test from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflow, readAllWorkflows, extractSites, resolveAgentDef, MODEL_TIER } from './binding-helpers.js'

test('AC-6: every workflow declares MODEL.strong/mid/cheap as opus/sonnet/haiku', () => {
  for (const { file, text } of readAllWorkflows()) {
    assert.ok(
      /const MODEL\s*=\s*\{\s*strong:\s*['"]opus['"]\s*,\s*mid:\s*['"]sonnet['"]\s*,\s*cheap:\s*['"]haiku['"]\s*\}/.test(text),
      `${file} must declare const MODEL = { strong: 'opus', mid: 'sonnet', cheap: 'haiku' }`,
    )
  }
})

test('AC-6: every bound site\'s model option agrees with its resolved definition\'s frontmatter model', () => {
  const mismatches = []
  for (const { file, text } of readAllWorkflows()) {
    for (const s of extractSites(text)) {
      if (!s.bound || !s.agentType) continue
      const def = resolveAgentDef(s.agentType)
      if (!def) { mismatches.push(`${file}: site '${s.label}' names unresolvable agentType '${s.agentType}'`); continue }
      const expected = MODEL_TIER[s.model]
      if (def.fm.model !== expected) {
        mismatches.push(`${file}: site '${s.label}' is ${s.model} (expects model '${expected}') but ${s.agentType}.md declares model '${def.fm.model}'`)
      }
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'))
})

test("AC-6: build-implement.js's integrate:resolve is bound at the strong tier, not to the haiku-tier 'mechanical' type", () => {
  const sites = extractSites(readWorkflow('build-implement.js'))
  const site = sites.find(s => s.label.replace(/^['"`]/, '') === 'integrate:resolve')
  assert.ok(site, "no site labelled 'integrate:resolve' found in build-implement.js")
  assert.equal(site.model, 'MODEL.strong', `integrate:resolve must carry model: MODEL.strong, got ${site.model}`)
  assert.notEqual(site.agentType, 'mechanical', "integrate:resolve must not be bound to the haiku-tier 'mechanical' type")
  assert.ok(site.bound, 'integrate:resolve must be bound to some agentType')
  const def = resolveAgentDef(site.agentType)
  assert.ok(def, `integrate:resolve names agentType '${site.agentType}', which has no committed definition`)
  assert.equal(def.fm.model, 'opus', `${site.agentType}.md must declare model 'opus' to match MODEL.strong`)
})
