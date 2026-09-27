// Helper for the B1 (build-spec.js) selectPatterns/formatPatterns tests, spec-wi-b1-b2-memory-to-build.
//
// AC-1's given is explicit that the sentinel-extraction idiom pulls the block holding selectPatterns/
// formatPatterns from EITHER the existing '// ---- BEGIN graph-lint ----'/'// ---- END graph-lint ----'
// block (reused in place) OR a new '// ---- BEGIN memory-patterns ----'/'// ---- END memory-patterns ----'
// block — the spec deliberately leaves that choice to the implementation. This helper tries the new
// sentinel pair first, then falls back to the existing graph-lint one, exactly mirroring that "either/or".
//
// Repo root is resolved via process.cwd() through fixloop-helpers.js's existing REPO export (never by
// counting '..' from this file's own on-disk location — this TestSet is authored under
// .artifacts/tests/implement-memory-to-build/ and lands under substrate/test/, two different depths
// below the repository root).
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

export const WORKFLOW_PATH = path.join(REPO, '.claude', 'workflows', 'build-spec.js')

export const NEW_BEGIN = '// ---- BEGIN memory-patterns ----'
export const NEW_END = '// ---- END memory-patterns ----'
export const OLD_BEGIN = '// ---- BEGIN graph-lint ----'
export const OLD_END = '// ---- END graph-lint ----'

export function readWorkflowText() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8')
}

function extractBetween(text, beginSentinel, endSentinel) {
  const lines = text.split('\n')
  const beginIdxs = []
  const endIdxs = []
  lines.forEach((line, i) => {
    if (line === beginSentinel) beginIdxs.push(i)
    if (line === endSentinel) endIdxs.push(i)
  })
  const beginIdx = beginIdxs[0]
  const endIdx = endIdxs.find(i => beginIdx != null && i > beginIdx)
  return (beginIdx == null || endIdx == null) ? null : lines.slice(beginIdx + 1, endIdx).join('\n')
}

// Returns { block, which } where `which` is 'memory-patterns' or 'graph-lint', or { block: null, which: null }
// if neither sentinel pair is present.
export function extractPatternsBlock(text) {
  const fresh = extractBetween(text, NEW_BEGIN, NEW_END)
  if (fresh != null) return { block: fresh, which: 'memory-patterns' }
  const reused = extractBetween(text, OLD_BEGIN, OLD_END)
  if (reused != null) return { block: reused, which: 'graph-lint' }
  return { block: null, which: null }
}

// Evaluates whichever block is found exactly as AC-1 describes and returns { selectPatterns, formatPatterns }.
export function loadPatternFunctions() {
  const { block, which } = extractPatternsBlock(readWorkflowText())
  if (block == null) {
    throw new Error('neither memory-patterns nor graph-lint sentinel block found in build-spec.js')
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return { selectPatterns, formatPatterns }`)
  return { ...factory(), which }
}
