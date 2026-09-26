// Shared helper for the graph-lint tests (spec-wi-b3-graph-lint / t-graph-lint).
//
// Reads .claude/workflows/build-spec.js as text, cuts the pure-JavaScript block delimited by the
// exact whole-line sentinels `// ---- BEGIN graph-lint ----` / `// ---- END graph-lint ----`, and
// evaluates it with `new Function` exactly the way AC-1 describes, so the nine exported functions
// can be exercised directly against plain-object fixtures without executing the workflow runtime
// (agent/parallel/pipeline/phase/log/args are not available here, by design — CLAUDE.md rule 9).
//
// REPO is resolved by walking up from this file's own directory until a directory containing both
// contracts.schema.json and COMPANY.md is found, rather than assuming a fixed number of path
// segments. This file is authored under .artifacts/tests/t-graph-lint/ (three segments below the
// repo root) and, once landed, is expected to live under substrate/test/ (two segments below the
// repo root) — a hardcoded '..'/'..' would silently resolve to the wrong directory in one of the
// two locations. See CLAUDE.md's runtime note: ".artifacts/ is gitignored... whatever the next
// stretch needs must be committed" — a helper that only works from one worktree layout is the same
// disease.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function findRepoRoot(startDir) {
  let dir = startDir
  for (;;) {
    if (fs.existsSync(path.join(dir, 'contracts.schema.json')) && fs.existsSync(path.join(dir, 'COMPANY.md'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`repository root not found above ${startDir}`)
    dir = parent
  }
}

export const REPO = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
export const WORKFLOW_PATH = path.join(REPO, '.claude', 'workflows', 'build-spec.js')

export const BEGIN_SENTINEL = '// ---- BEGIN graph-lint ----'
export const END_SENTINEL = '// ---- END graph-lint ----'

export function readWorkflowText() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8')
}

// Returns { block, beginCount, endCount }. `block` is the text strictly between the first BEGIN
// sentinel line and the first following END sentinel line (matching whole lines, not substrings),
// or null if either sentinel is missing.
export function extractBlock(text) {
  const lines = text.split('\n')
  const beginIdxs = []
  const endIdxs = []
  lines.forEach((line, i) => {
    if (line === BEGIN_SENTINEL) beginIdxs.push(i)
    if (line === END_SENTINEL) endIdxs.push(i)
  })
  const beginIdx = beginIdxs[0]
  const endIdx = endIdxs.find(i => beginIdx != null && i > beginIdx)
  const block = (beginIdx == null || endIdx == null) ? null : lines.slice(beginIdx + 1, endIdx).join('\n')
  return { block, beginCount: beginIdxs.length, endCount: endIdxs.length }
}

// Evaluates the extracted block exactly as AC-1 prescribes and returns the object of all nine
// exported functions.
export function loadGraphLint() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('graph-lint block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return {
      surfaceRef, withinOwned, criterionPaths, classifyCriterion,
      checkCriterionReachability, checkFalseEdges, checkCriterionCoverage, checkTestSurfaces, lintGraph,
    }`)
  return factory()
}

// ---- Plain-object fixture builders (contract-shaped: contracts.schema.json Surface/Criterion/Task/Spec/TaskGraph) ----

export function surf(ref, kind = 'path') {
  return { kind, ref }
}

// A Criterion whose given/when/then together carry `then` as the load-bearing text a check reads
// (path names, change-scoped phrasing, etc). given/when are filler so the object stays contract-shaped.
export function crit(id, then, given = 'the described precondition holds', when = 'the described action happens') {
  return { id, given, when, then, testable: true }
}

export function task(id, { owns = [], deps = [], criteria = [], spec_id = 'spec-1', description } = {}) {
  return {
    id, spec_id, description: description ?? `implement ${id}`,
    owned_surfaces: owns.map(r => surf(r)),
    depends_on: deps,
    criteria_ids: criteria,
  }
}

export function spec(id, { acceptance = [], touched = [], goal = 'goal', work_item_id = 'wi-1', out_of_scope = [] } = {}) {
  return {
    id, work_item_id, goal,
    acceptance,
    touched_surfaces: touched.map(r => (typeof r === 'string' ? surf(r) : r)),
    out_of_scope,
  }
}

export function graph(spec_id, tasks) {
  return { spec_id, tasks }
}
