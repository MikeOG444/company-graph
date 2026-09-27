// Shared helper for the fix-loop decision-block tests (spec-wi-opp-p5-4 / AC-1, extended by
// spec-wi-unactionable-findings / AC-1 with the nine owned-surfaces-boundary and unactionable-finding
// decisions).
//
// Reads .claude/workflows/build-implement.js as text, cuts the pure-JavaScript block
// delimited by the exact sentinel lines, and evaluates it with `new Function` exactly
// the way AC-1 describes, so the seventeen decision functions can be exercised directly
// without executing the rest of the workflow (which needs runtime handles this test
// suite never constructs).
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './fixloop-helpers.js'

export const WORKFLOW_PATH = path.join(REPO, '.claude', 'workflows', 'build-implement.js')
export const FIXER_MD_PATH = path.join(REPO, '.claude', 'agents', 'fixer.md')
export const LENS_SPEC_CONFORMANCE_MD_PATH = path.join(REPO, '.claude', 'agents', 'lens-spec-conformance.md')

export const BEGIN_SENTINEL = '// ---- BEGIN fix-loop decisions ----'
export const END_SENTINEL = '// ---- END fix-loop decisions ----'

export function readWorkflowText() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8')
}

// Returns { block, beginCount, endCount }. `block` is the text strictly between the
// first BEGIN sentinel line and the first following END sentinel line (matching whole
// lines, not substrings), or null if either sentinel is missing.
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

// Evaluates the extracted block exactly as AC-1 prescribes and returns the object of all
// seventeen pre-existing decision functions.
export function loadFixLoopDecisions() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return {
      scopeOf, scopeTargets, nextLenses, lensesToRun, roundBudget, taskCeiling, emptyDiffAction, shouldEscalate,
      surfaceRef, withinOwned, boundaryCheck, criteriaScope, citedCriteria, isForeignCriterionFinding,
      stripForeignFindings, routeFinding, fixOutcome,
    }`)
  return factory()
}

// spec-wi-c15-c12-c14-line-guards AC-1: the block is extended with outputCeiling, verifyGate,
// newStrays "and any ratio or budget-state helper the implementation adds". Rather than hardcoding a
// guessed name for a helper the Spec does not name, this walks EVERY top-level `function name(...)`
// declaration textually present in the extracted block (a plain regex is safe here because the whole
// block is later handed to `new Function` as a unit — if the regex over- or under-counts, the returned
// object simply omits or duplicates a binding and the affected test fails loudly, it does not silently
// pass) and returns all of them, keyed by name, alongside the seventeen pre-existing ones above.
const TOP_LEVEL_FN_RE = /(?:^|\n)function\s+([A-Za-z_$][\w$]*)\s*\(/g

export function loadAllFixLoopFunctions() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  const names = new Set()
  let m
  const re = new RegExp(TOP_LEVEL_FN_RE)
  while ((m = re.exec(block))) names.add(m[1])
  if (!names.size) throw new Error('no top-level function declarations found in the fix-loop decisions block')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `\n    return { ${[...names].join(', ')} }`)
  return { fns: factory(), names: [...names], block }
}
