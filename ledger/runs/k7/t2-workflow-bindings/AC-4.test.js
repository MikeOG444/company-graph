// AC-4 (spec-wi-a5-agent-least-privilege): "the WRITE_PERMITTED allowlist ... contains exactly the
// mechanical and write-legitimate sites — every AT('mechanical') site, the implementer, test-author,
// fixer, reproducer and patch-drafter sites, build-implement's integrate:resolve, and launch.js's
// release-notes 'notes' site — each carrying a one-line reason string; an allowlist entry that matches no
// site in any workflow also fails, so the list cannot rot."
//
// This allowlist is declared here, in the test file, as AC-3 requires (a judgment node cannot regain a
// commit tool without a human editing this list). It is keyed by workflow filename plus a label pattern:
// either the exact label text a site carries, or, for a templated label (built with a backtick and
// `${...}`), the literal prefix before the first `${`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readAllWorkflows, extractSites } from './binding-helpers.js'

// Normalize a captured `label:` expression (which may be `'x'`, `"x"`, or `` `x:${expr}` ``) down to a
// plain string for matching: strip the surrounding quote/backtick, and truncate at the first `${`.
function normalizeLabel(raw) {
  const unquoted = raw.trim().replace(/^['"`]/, '').replace(/['"`]$/, '')
  const dollarIdx = unquoted.indexOf('${')
  return dollarIdx === -1 ? unquoted : unquoted.slice(0, dollarIdx)
}

// file -> [{ pattern, reason }]. `pattern` matches a normalized label via `startsWith` for templated labels
// (pattern ends with the literal prefix already) or exact equality for static ones — both are just prefix
// matches since a static label's prefix IS the whole label.
export const WRITE_PERMITTED = {
  'build-spec.js': [],
  'build-implement.js': [
    { pattern: 'gate:spec_gate', reason: "mechanical: runs `node substrate/gates.js show` and reports, no judgment" },
    { pattern: 'checkout:', reason: 'mechanical: git worktree add, a deterministic shell step' },
    { pattern: 'impl:', reason: 'implementer: the Build-line Implementer legitimately edits the worktree' },
    { pattern: 'tests:', reason: 'test-author: writes the TestSet files into the worktree' },
    { pattern: 'rediff:', reason: 'mechanical: rewrites the cumulative diff, a deterministic shell step' },
    { pattern: 'canary:', reason: 'mechanical: applies a deliberate canary mutation in the worktree' },
    { pattern: 'run:', reason: 'mechanical: runs the test suite and reports results, no judgment' },
    { pattern: 'scope:', reason: 'mechanical: slices the cumulative diff into per-file patches' },
    { pattern: 'testfix:', reason: 'test-author: repairs a finding located in the tests it wrote' },
    { pattern: 'fix:', reason: 'fixer: patches one finding in the worktree' },
    { pattern: 'merge:', reason: 'mechanical: merges applied fix patches, a deterministic shell step' },
    { pattern: 'integrate', reason: 'mechanical: runs the integration branch test suite' },
    { pattern: 'integrate:resolve', reason: 'own strong-tier write-permitted definition: resolves integration conflicts by editing the worktree; not bound to the haiku-tier mechanical type so the model is not silently downgraded' },
  ],
  'build-reentry.js': [
    { pattern: 'load', reason: 'mechanical: reads a JSON file verbatim, a deterministic step' },
    { pattern: 'gate:sev1_page', reason: 'mechanical: runs `node substrate/gates.js show` and reports' },
  ],
  'create-project.js': [
    { pattern: 'gate:brief_approval', reason: 'mechanical: runs `node substrate/gates.js show` and reports' },
    { pattern: 'scaffold', reason: 'mechanical: writes the scaffolded app to disk' },
    { pattern: 'ci', reason: 'mechanical: runs the test command and reports results' },
  ],
  'launch.js': [
    { pattern: 'digest', reason: 'mechanical: reads the EvidenceBundle, a deterministic step' },
    { pattern: 'artifact', reason: 'mechanical: runs git rev-parse and reports' },
    { pattern: 'gate-queue', reason: 'mechanical: runs `node substrate/gates.js list --json` and reports' },
    { pattern: 'notes', reason: "release-notes writer: named explicitly by the spec as write-permitted for launch.js's 'notes' site" },
  ],
  'maintain-triage.js': [
    { pattern: 'intake:signals', reason: 'mechanical: reads a JSON file verbatim, a deterministic step' },
    { pattern: 'intake', reason: 'mechanical: runs git rev-parse and reports' },
    { pattern: 'mitigate:rollback', reason: 'mechanical: runs the deliberate, reversible rollback commands' },
    { pattern: 'repro:', reason: 'reproducer: writes a failing regression test into the worktree' },
    { pattern: 'draft:', reason: 'patch-drafter: drafts the smallest patch plus its regression test' },
    { pattern: 'verify:', reason: 'mechanical: runs commands to measure a patch, no edits' },
    { pattern: 'persist:seen', reason: 'mechanical: appends a fingerprint to the known-issues file' },
  ],
  'deploy.js': [
    { pattern: 'gate:launch_approval', reason: 'mechanical: runs `node substrate/gates.js show` and reports' },
    { pattern: 'deploy:baseline', reason: 'mechanical: runs the deploy CLI baseline check' },
    { pattern: 'deploy:canary', reason: 'mechanical: runs the deploy CLI checkout to canary' },
    { pattern: 'watch:', reason: 'mechanical: runs the deploy CLI post-launch probe' },
    { pattern: 'promote', reason: 'mechanical: runs the deploy CLI promote step' },
    { pattern: 'rollback', reason: 'mechanical: runs the deploy CLI rollback step' },
  ],
  'improve-analyze.js': [
    { pattern: 'burn:ledger', reason: 'mechanical: runs `node substrate/ledger.js summary` and reports' },
  ],
  'memory-roll.js': [
    { pattern: 'panel_facts', reason: 'mechanical: runs a reporting command and reports exactly what it prints' },
    { pattern: 'method_rows', reason: 'mechanical: runs reporting commands and reports exactly what they print' },
  ],
}

function allEntries() {
  const out = []
  for (const [file, entries] of Object.entries(WRITE_PERMITTED)) {
    for (const e of entries) out.push({ file, ...e })
  }
  return out
}

test('AC-4: every WRITE_PERMITTED entry carries a non-empty one-line reason string', () => {
  for (const e of allEntries()) {
    assert.ok(typeof e.reason === 'string' && e.reason.trim().length > 0, `${e.file} / ${e.pattern}: missing reason`)
    assert.ok(!e.reason.includes('\n'), `${e.file} / ${e.pattern}: reason must be one line`)
  }
})

test('AC-4: every WRITE_PERMITTED entry matches at least one site actually present in its workflow (no rot)', () => {
  const byFile = Object.fromEntries(readAllWorkflows().map(({ file, text }) => [file, extractSites(text)]))
  const unmatched = []
  for (const e of allEntries()) {
    const sites = byFile[e.file] ?? []
    const hit = sites.some(s => normalizeLabel(s.label).startsWith(e.pattern) || e.pattern.startsWith(normalizeLabel(s.label)))
    if (!hit) unmatched.push(`${e.file}: allowlist entry '${e.pattern}' matches no site currently in the file`)
  }
  assert.deepEqual(unmatched, [], unmatched.join('\n'))
})

test('AC-4: the allowlist contains exactly the type-based write-legitimate sites plus the two named exceptions', () => {
  // Cross-check against the actual agentType bound at each site, once bound: any site resolving to
  // mechanical/implementer/test-author/fixer/reproducer/patch-drafter must be covered by some allowlist
  // entry in its file, and the two named exceptions (build-implement's integrate:resolve, launch's notes)
  // must be present regardless of what type they end up bound to.
  const WRITE_LEGIT_TYPES = new Set(['mechanical', 'implementer', 'test-author', 'fixer', 'reproducer', 'patch-drafter'])
  const missing = []
  for (const { file, text } of readAllWorkflows()) {
    const sites = extractSites(text)
    const entries = WRITE_PERMITTED[file] ?? []
    for (const s of sites) {
      const label = normalizeLabel(s.label)
      const named = (file === 'build-implement.js' && label === 'integrate:resolve') || (file === 'launch.js' && label === 'notes')
      const typeBased = s.agentType && WRITE_LEGIT_TYPES.has(s.agentType)
      if (!named && !typeBased) continue
      const covered = entries.some(e => label.startsWith(e.pattern) || e.pattern.startsWith(label))
      if (!covered) missing.push(`${file}: site '${s.label}' (agentType ${s.agentType ?? 'none'}) should be in WRITE_PERMITTED but is not`)
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'))
})
