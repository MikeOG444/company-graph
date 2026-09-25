// AC-9 (spec-wi-a5-agent-least-privilege): "a judgment call site bound to a read-only type, whose role
// prompt disappears if the runtime has not yet registered that type ... the prompt itself states the
// read-only constraint inline (it must not create, edit or delete files, or run commands that change the
// repository), so the constraint survives a dropped agentType, and the existing instruction sentences
// describing WHAT to decide are preserved verbatim."
//
// Scope: the spec's audit is of the 15 sites this task binds, and of those, 13 become judgment/read-only
// (all but build-implement's integrate:resolve and launch's release-notes 'notes', both write-permitted —
// see AC-4). Sites that were ALREADY bound to a read-only type before this task (e.g. improve-analyze.js's
// usage_analyst, memory-roll.js's estimate_inputs) are untouched surfaces per the spec's exclusions
// ("Changing what any agent is asked to decide... prompts gain only inline restatements of the tool
// constraint" describes what the 15 newly-bound sites gain, not a rewrite of every already-bound prompt in
// the repo), so this test checks exactly the 13 sites this task turns read-only, by file and label prefix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllWorkflows, extractSites, promptBefore, resolveAgentDef, toolsList, holdsWriteTool } from './binding-helpers.js'

// A judgment/read-only definition's tools are exactly Read, Glob, Grep.
function isReadOnlyDef(def) {
  if (!def) return false
  const tools = [...toolsList(def.fm)].sort()
  return !holdsWriteTool(tools) && tools.length > 0
}

// The prompt must, in its own words, tell the agent it may not create/edit/delete files or run
// repository-changing commands. Accept reasonable phrasings rather than one exact sentence, since the
// constraint only has to be restated in substance.
const NO_FILE_EDIT_RE = /\b(do not|must not|never)\b[^.]{0,80}\b(create|edit|delete|write|commit)\b/i
const NO_REPO_CHANGE_RE = /(change the repository|changes? the repo\b|run\s+(no|nothing|only)\b|read[- ]only|read freely,?\s*write nothing)/i

// The 13 sites this task turns read-only, by (file, label prefix). Excludes the two write-permitted
// exceptions (build-implement's integrate:resolve, launch's notes — see AC-4's WRITE_PERMITTED allowlist).
const NEWLY_JUDGMENT_SITES = [
  { file: 'build-spec.js', prefix: 'spec:' },
  { file: 'build-spec.js', prefix: 'route:' },
  { file: 'build-spec.js', prefix: 'decompose:' },
  { file: 'build-implement.js', prefix: 'escalate:' }, // matches all three escalate: sites
  { file: 'build-implement.js', prefix: 'tiebreak:' },
  { file: 'build-implement.js', prefix: 'dispute:' },
  { file: 'build-reentry.js', prefix: 'classify:' },
  { file: 'build-reentry.js', prefix: 'surfaces:' },
  { file: 'create-project.js', prefix: 'stack' },
  { file: 'create-project.js', prefix: 'seed' },
  { file: 'maintain-triage.js', prefix: 'incident' },
]

test('AC-9: every one of the 13 newly-judgment sites has an inline read-only constraint in its prompt', () => {
  const missing = []
  const byFile = Object.fromEntries(readAllWorkflows().map(w => [w.file, { text: w.text, sites: extractSites(w.text) }]))
  let checked = 0
  for (const target of NEWLY_JUDGMENT_SITES) {
    const { text, sites } = byFile[target.file]
    const matches = sites.filter(s => s.label.replace(/^['"`]/, '').startsWith(target.prefix))
    assert.ok(matches.length > 0, `${target.file}: no site found with label prefix '${target.prefix}'`)
    for (const s of matches) {
      checked++
      assert.ok(s.bound, `${target.file}: site '${s.label}' must be bound to an agentType`)
      const def = resolveAgentDef(s.agentType)
      assert.ok(def, `${target.file}: site '${s.label}' names agentType '${s.agentType}', which has no committed definition`)
      assert.ok(isReadOnlyDef(def), `${target.file}: site '${s.label}' (agentType ${s.agentType}) must be bound to a read-only (Read/Glob/Grep-only) definition`)
      const prompt = promptBefore(text, s)
      const hasEditConstraint = NO_FILE_EDIT_RE.test(prompt)
      const hasRepoConstraint = NO_REPO_CHANGE_RE.test(prompt)
      if (!hasEditConstraint && !hasRepoConstraint) {
        missing.push(`${target.file}: site '${s.label}' (agentType ${s.agentType}) has no inline read-only constraint in its prompt`)
      }
    }
  }
  assert.equal(checked, 13, `expected exactly 13 newly-judgment sites to check, found ${checked}`)
  assert.deepEqual(missing, [], missing.join('\n'))
})

test('AC-9: build-spec.js\'s spec site keeps its existing WHAT-to-decide instruction verbatim alongside the constraint', () => {
  const text = readAllWorkflows().find(w => w.file === 'build-spec.js').text
  const sites = extractSites(text)
  const spec = sites.find(s => s.label.replace(/^['"`]/, '').startsWith('spec:'))
  const prompt = promptBefore(text, spec)
  assert.ok(/YOU ARE SPECIFYING THE WORK, NOT DOING IT/.test(prompt),
    'the existing instruction sentence describing what the spec writer decides must survive verbatim')
  assert.ok(/Acceptance criteria must be testable Given\/When\/Then/.test(prompt),
    'the existing instruction sentence about acceptance criteria must survive verbatim')
})
