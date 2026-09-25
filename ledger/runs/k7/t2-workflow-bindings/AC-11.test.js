// AC-11 (spec-wi-a5-agent-least-privilege): "the historical pre-fix text of build-spec.js, in which the
// spec, route and decompose option objects carry no agentType, supplied as a string fixture ... the test's
// scanner — a pure function of workflow text plus a definitions map, reading nothing from disk at call time
// — is run over it ... it reports all three sites as unbound violations, demonstrating the guard failing on
// the shape that actually shipped rather than only passing on the fixed one, and the same scanner run over
// the fixed tree reports zero violations."
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSites, readWorkflow } from './binding-helpers.js'

// A fixture reproducing the actual pre-fix shape of build-spec.js's three unbound sites (captured before
// task t2-workflow-bindings landed, not inferred from its implementation): each option object carries
// label, model and schema but no agentType at all.
const HISTORICAL_BUILD_SPEC_FIXTURE = `
phase('Spec')
const specced = (await pipeline(selected, async (w) => {
  const spec = await agent(
    \`Write a Spec for this work item for the app at ./\${A.repo}/ (a directory of this git repository). Read its code and tests as needed.
     YOU ARE SPECIFYING THE WORK, NOT DOING IT. Work item: \${JSON.stringify(w)}\`,
    { label: \`spec:\${w.id}\`, model: MODEL.strong, schema: Spec })
  if (!spec) return null

  const [risk, graph] = await parallel([
    () => agent(\`Classify blast radius of this spec as low or high, with reasons. Spec: \${JSON.stringify(spec)}\`,
      { label: \`route:\${w.id}\`, model: MODEL.cheap, schema: Risk }),
    () => agent(\`Decompose this spec into IMPLEMENTATION tasks with DISJOINT owned surfaces. Spec: \${JSON.stringify(spec)}\`,
      { label: \`decompose:\${w.id}\`, model: MODEL.cheap, schema: TaskGraph }),
  ])
  return { spec, risk, graph }
}))
`

test('AC-11: the scanner is a pure function of text alone — the same input always yields the same output, with no filesystem access', () => {
  const a = extractSites(HISTORICAL_BUILD_SPEC_FIXTURE)
  const b = extractSites(HISTORICAL_BUILD_SPEC_FIXTURE)
  assert.deepEqual(a, b, 'extractSites must return identical results for identical input text')
})

test('AC-11: run over the historical pre-fix fixture, the scanner reports all three build-spec sites as unbound', () => {
  const sites = extractSites(HISTORICAL_BUILD_SPEC_FIXTURE)
  assert.equal(sites.length, 3, 'expected exactly three call sites in the historical fixture (spec, route, decompose)')
  const unbound = sites.filter(s => !s.bound)
  assert.equal(unbound.length, 3, 'all three historical sites must be reported unbound: the guard must fail on the shape that actually shipped')
  assert.deepEqual(unbound.map(s => s.label.replace(/^[`'"]/, '').split(':')[0]).sort(), ['decompose', 'route', 'spec'])
})

test('AC-11: run over the fixed tree (the actual build-spec.js on disk today), the scanner reports zero unbound violations', () => {
  const text = readWorkflow('build-spec.js')
  const sites = extractSites(text)
  const unbound = sites.filter(s => !s.bound)
  assert.deepEqual(unbound.map(s => s.label), [], 'the fixed build-spec.js must bind every site to an agentType')
})
