// AC-5 (spec-wi-a5-agent-least-privilege): "build-spec.js, which today has no AT() helper and three
// unbound sites ... all three are bound through an AT() helper to agentTypes whose definitions carry
// exactly 'Read, Glob, Grep', the spec writer's definition is at the strong tier and grants no Bash, and no
// agent label 'planner' reappears (the plan-selection block between the existing sentinels is untouched)."
import test from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflow, extractSites, resolveAgentDef, toolsList, holdsWriteTool, MODEL_TIER } from './a5-binding-helpers.js'

const FILE = 'build-spec.js'

function siteFor(sites, prefix) {
  return sites.find(s => s.label.replace(/^['"`]/, '').startsWith(prefix))
}

test('AC-5: build-spec.js has an AT() (or NEW()) helper', () => {
  const text = readWorkflow(FILE)
  assert.ok(/^\s*const AT\s*=/m.test(text) || /^\s*const NEW\s*=/m.test(text),
    'build-spec.js must declare an AT()/NEW() helper, like the other eight workflows')
})

test('AC-5: the spec, route and decompose sites in build-spec.js are all bound to an agentType', () => {
  const sites = extractSites(readWorkflow(FILE))
  for (const prefix of ['spec:', 'route:', 'decompose:']) {
    const site = siteFor(sites, prefix)
    assert.ok(site, `no site found with label prefix '${prefix}' in build-spec.js`)
    assert.ok(site.bound, `site '${site.label}' in build-spec.js names no agentType`)
  }
})

test("AC-5: the spec, route and decompose sites' definitions carry exactly Read, Glob, Grep", () => {
  const sites = extractSites(readWorkflow(FILE))
  for (const prefix of ['spec:', 'route:', 'decompose:']) {
    const site = siteFor(sites, prefix)
    const def = resolveAgentDef(site.agentType)
    assert.ok(def, `site '${site.label}' names agentType '${site.agentType}', which has no committed .claude/agents/${site.agentType}.md`)
    const tools = [...toolsList(def.fm)].sort()
    assert.deepEqual(tools, ['Glob', 'Grep', 'Read'], `${site.agentType}.md must list tools exactly Read, Glob, Grep, got [${tools.join(', ')}]`)
  }
})

test('AC-5: the spec writer is bound at the strong tier and its definition grants no Bash', () => {
  const sites = extractSites(readWorkflow(FILE))
  const spec = siteFor(sites, 'spec:')
  assert.equal(spec.model, 'MODEL.strong', `the spec writer's model option must be MODEL.strong, got ${spec.model}`)
  const def = resolveAgentDef(spec.agentType)
  assert.ok(def, `spec site names agentType '${spec.agentType}', which has no committed definition`)
  assert.equal(def.fm.model, MODEL_TIER[spec.model], `${spec.agentType}.md frontmatter model must be '${MODEL_TIER[spec.model]}' to match MODEL.strong`)
  assert.ok(!holdsWriteTool(toolsList(def.fm)), `${spec.agentType}.md must not grant Bash (or Write/Edit)`)
})

test("AC-5: no agent label 'planner' reappears in build-spec.js", () => {
  const text = readWorkflow(FILE)
  assert.ok(!/label:\s*[`'"]planner/.test(text), "selecting work items is script code; no agent() call may carry label 'planner'")
})

test('AC-5: the plan-selection sentinel block is untouched (still present, whole-line sentinels)', () => {
  const text = readWorkflow(FILE)
  const lines = text.split('\n')
  const begin = lines.indexOf('// ---- BEGIN plan-selection ----')
  const end = lines.indexOf('// ---- END plan-selection ----')
  assert.notEqual(begin, -1, 'BEGIN plan-selection sentinel missing')
  assert.ok(end > begin, 'END plan-selection sentinel missing or before BEGIN')
})
