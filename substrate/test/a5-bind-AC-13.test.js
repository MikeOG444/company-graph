// AC-13 (spec-wi-a5-agent-least-privilege): "the workflow scripts before and after the change: the set of
// agent() sites is compared by label pattern, model tier and schema name in each file ... the sets are
// identical — no agent() call is added, removed, re-labelled, re-tiered or given a different schema, and no
// pipeline/parallel/phase structure changes — so this work item alters only what each node is permitted to
// touch."
//
// BASELINE below is a fixture of the repo's pre-task state — the (label, model, schema) triple of every
// agent() call site in every workflow this task owns, captured before task t2-workflow-bindings landed. It
// is not inferred from the implementation: binding an agentType to a site does not change its label, model
// tier or schema, so this triple is exactly what AC-13 says must survive unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllWorkflows, extractSites } from './a5-binding-helpers.js'

const BASELINE = {
  'build-spec.js': [
    { label: '`spec:${w.id}`', model: 'MODEL.strong', schema: 'Spec' },
    { label: '`route:${w.id}`', model: 'MODEL.cheap', schema: 'Risk' },
    { label: '`decompose:${w.id}`', model: 'MODEL.cheap', schema: 'TaskGraph' },
  ],
  'build-implement.js': [
    { label: "'gate:spec_gate'", model: 'MODEL.cheap', schema: 'GateCheck' },
    { label: '`checkout:${task.id}`', model: 'MODEL.cheap', schema: 'ChangeSet' },
    { label: '`impl:${task.id}`', model: 'MODEL.mid', schema: 'ChangeSet' },
    { label: '`tests:${task.id}`', model: 'MODEL.mid', schema: 'TestSet' },
    { label: '`rediff:${task.id}`', model: 'MODEL.cheap', schema: 'ChangeSet' },
    { label: '`escalate:${task.id}`', model: 'MODEL.strong', schema: 'Escalation' },
    { label: '`canary:${task.id}`', model: 'MODEL.cheap', schema: 'ChangeSet' },
    { label: '`escalate:${task.id}`', model: 'MODEL.strong', schema: 'Escalation' },
    { label: '`run:${task.id}:${tag}`', model: 'MODEL.cheap', schema: 'TestResults' },
    { label: '`lens:${name}:${task.id}:${tag}`', model: 'MODEL.cheap', schema: 'Verdict' },
    { label: '`tiebreak:${task.id}:${tag}`', model: 'MODEL.strong', schema: 'Verdict' },
    { label: '`escalate:${task.id}`', model: 'MODEL.strong', schema: 'Escalation' },
    { label: '`scope:${task.id}:${tag}`', model: 'MODEL.cheap', schema: 'ScopeMap' },
    { label: '`testfix:${task.id}:${f.id}`', model: 'MODEL.mid', schema: 'TestRepair' },
    { label: '`fix:${task.id}:${f.id}`', model: 'MODEL.mid', schema: 'ChangeSet' },
    { label: '`testfix:${task.id}:${x.f.id}`', model: 'MODEL.mid', schema: 'TestRepair' },
    { label: '`dispute:${task.id}:${x.f.id}`', model: 'MODEL.mid', schema: 'Ruling' },
    { label: '`merge:${task.id}:r${ctx.round}`', model: 'MODEL.cheap', schema: 'ChangeSet' },
    // Added deliberately by spec-wi-b5-sibling-value-repair (landed k9d): the one boundary-repair re-run of a
    // strayer's implementer. Same tier and schema as impl:${task.id}. This fixture freezes A5's invariant
    // (bindings changed nothing else); a later spec that adds a site must add it here, by name, with its reason.
    { label: '`impl:${task.id}:repair`', model: 'MODEL.mid', schema: 'ChangeSet' },
    { label: "'integrate'", model: 'MODEL.cheap', schema: 'Suite' },
    { label: "'integrate:resolve'", model: 'MODEL.strong', schema: 'Suite' },
  ],
  'build-reentry.js': [
    { label: "'load'", model: 'MODEL.cheap', schema: 'Loaded' },
    { label: '`classify:${p.id}`', model: 'MODEL.cheap', schema: 'Classification' },
    { label: '`surfaces:${w.id}`', model: 'MODEL.cheap', schema: 'Surfaces' },
    { label: "'gate:sev1_page'", model: 'MODEL.cheap', schema: 'GateCheck' },
  ],
  'create-project.js': [
    { label: "'gate:brief_approval'", model: 'MODEL.cheap', schema: 'GateCheck' },
    { label: "'stack'", model: 'MODEL.cheap', schema: 'StackDecision' },
    { label: "'scaffold'", model: 'MODEL.cheap', schema: 'RepoHandle' },
    { label: "'ci'", model: 'MODEL.cheap', schema: 'CiResult' },
    { label: "'seed'", model: 'MODEL.cheap', schema: 'Seed' },
  ],
  'launch.js': [
    { label: "'digest'", model: 'MODEL.cheap', schema: 'Digest' },
    { label: "'artifact'", model: 'MODEL.cheap', schema: 'ArtifactCheck' },
    { label: "'gate-queue'", model: 'MODEL.cheap', schema: 'GateQueue' },
    { label: "'notes'", model: 'MODEL.cheap', schema: 'Notes' },
  ],
  'maintain-triage.js': [
    { label: "'intake:signals'", model: 'MODEL.cheap', schema: 'Intake' },
    { label: "'mitigate:rollback'", model: 'MODEL.cheap', schema: 'MitigationStep' },
    { label: '`triage:${signal.id}`', model: 'MODEL.cheap', schema: 'TriageC' },
    { label: '`repro:${signal.id}:a${n}`', model: 'MODEL.mid', schema: 'ReproC' },
    { label: '`rca:${signal.id}`', model: 'MODEL.mid', schema: 'CauseC' },
    { label: '`draft:${signal.id}`', model: 'MODEL.mid', schema: 'ChangeSetC' },
    { label: '`verify:${signal.id}`', model: 'MODEL.cheap', schema: 'PatchCheck' },
    { label: "'incident'", model: 'MODEL.mid', schema: 'IncidentNarrative' },
    { label: "'persist:seen'", model: 'MODEL.cheap', schema: 'Persisted' },
  ],
  'deploy.js': [
    { label: "'gate:launch_approval'", model: 'MODEL.cheap', schema: 'GateCheck' },
    { label: "'deploy:baseline'", model: 'MODEL.cheap', schema: 'DeployStep' },
    { label: "'deploy:canary'", model: 'MODEL.cheap', schema: 'DeployStep' },
    { label: '`watch:r${r}`', model: 'MODEL.cheap', schema: 'Probe' },
    { label: "'promote'", model: 'MODEL.cheap', schema: 'DeployStep' },
    { label: "'rollback'", model: 'MODEL.cheap', schema: 'DeployStep' },
    { label: "'rollback'", model: 'MODEL.cheap', schema: 'DeployStep' },
  ],
  'improve-analyze.js': [
    { label: "'usage_analyst'", model: 'MODEL.cheap', schema: 'Insights' },
    { label: "'feedback_analyst'", model: 'MODEL.cheap', schema: 'Themes' },
    { label: "'kill_criteria_facts'", model: 'MODEL.cheap', schema: 'KillFacts' },
    { label: "'burn:ledger'", model: 'MODEL.cheap', schema: 'Burn' },
    { label: "'opportunity_synthesizer'", model: 'MODEL.strong', schema: 'Synthesis' },
    { label: "'verdict_rationale'", model: 'MODEL.mid', schema: 'Rationale' },
  ],
  'memory-roll.js': [
    { label: "'panel_facts'", model: 'MODEL.cheap', schema: 'PanelFacts' },
    { label: "'method_rows'", model: 'MODEL.cheap', schema: 'MethodRows' },
    { label: "'estimate_inputs'", model: 'MODEL.cheap', schema: 'Estimates' },
    { label: "'extraction'", model: 'MODEL.cheap', schema: 'Extraction' },
  ],
}

function triples(sites) {
  return sites.map(s => `${s.label}|${s.model}|${s.schema}`).sort()
}

test('AC-13: the set of agent() sites (label, model tier, schema) in each workflow is unchanged', () => {
  for (const { file, text } of readAllWorkflows()) {
    const before = BASELINE[file]
    assert.ok(before, `no baseline recorded for ${file}`)
    const after = extractSites(text)
    assert.deepEqual(
      triples(after),
      triples(before),
      `${file}: the set of agent() sites by (label, model, schema) must be unchanged — no call added, removed, re-labelled, re-tiered, or given a different schema`,
    )
  }
})

test('AC-13: no workflow gained or lost an agent() call site count', () => {
  for (const { file, text } of readAllWorkflows()) {
    const before = BASELINE[file]
    const after = extractSites(text)
    assert.equal(after.length, before.length, `${file}: expected ${before.length} agent() call sites, found ${after.length}`)
  }
})

test('AC-13: pipeline/parallel/phase call counts are unchanged in each workflow', () => {
  // A structural proxy for "no pipeline/parallel/phase structure changes": the number of times each of
  // these control-flow primitives is invoked is a property of the workflow's shape, not of any option
  // object, and this task's own scope excludes touching structure at all.
  const countCalls = (text, name) => (text.match(new RegExp(`\\b${name}\\s*\\(`, 'g')) ?? []).length
  const BASELINE_STRUCTURE = {
    'build-spec.js': { pipeline: 1, parallel: 1, phase: 2 },
    'build-implement.js': { pipeline: 1, parallel: 5, phase: 3 },
    'build-reentry.js': { pipeline: 0, parallel: 1, phase: 3 },
    'create-project.js': { pipeline: 0, parallel: 1, phase: 3 },
    'launch.js': { pipeline: 0, parallel: 2, phase: 2 },
    'maintain-triage.js': { pipeline: 1, parallel: 0, phase: 3 },
    'deploy.js': { pipeline: 0, parallel: 1, phase: 5 },
    'improve-analyze.js': { pipeline: 0, parallel: 1, phase: 3 },
    'memory-roll.js': { pipeline: 0, parallel: 1, phase: 2 },
  }
  for (const { file, text } of readAllWorkflows()) {
    const expected = BASELINE_STRUCTURE[file]
    for (const name of ['pipeline', 'parallel', 'phase']) {
      const count = countCalls(text, name)
      assert.equal(count, expected[name], `${file}: expected ${expected[name]} call(s) to ${name}(...), found ${count}`)
    }
  }
})
