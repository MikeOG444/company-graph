// Shared helpers for the k17 TestSet (spec-wi-c13-b7-small-line-fixes / impl-c13-b7-small-line-fixes).
//
// Written from the spec ONLY. Two extraction concerns:
//
// 1. Risk Router (C13): AC-1 describes reading .claude/workflows/build-spec.js as text and extracting the
//    HIGH_KINDS, HIGH_REF and codeRisk declarations "near the top of the file", evaluated with `new Function`
//    the same way substrate/test/graph-lint-helpers.js evaluates the graph-lint sentinel block — except these
//    three declarations sit BEFORE the graph-lint sentinels, so this file locates them independently, by
//    their own exact declaration text rather than any textual index of an unrelated occurrence.
//
// 2. Fix-loop decisions (B7): AC-6 describes the existing sentinel-delimited block
//    (readWorkflowText()/extractBlock() from extract-fixloop.js, this TestSet's own copy) plus the new
//    changeScopedCriteria and testFileBasename functions, alongside every pre-existing decision function.
//    loadAllFixLoopDecisions() below names every function currently declared in that block (verified against
//    the committed source at authoring time) plus the two new ones, so AC-6's "every decision function the
//    existing loaders expose... is still a function" is actually checked against the full set, not assumed.
import fs from 'node:fs'
import { REPO } from './fixloop-helpers.js'
import { readWorkflowText as readImplementText, extractBlock } from './extract-fixloop.js'

export const BUILD_SPEC_PATH = `${REPO}/.claude/workflows/build-spec.js`

export function readBuildSpecText() {
  return fs.readFileSync(BUILD_SPEC_PATH, 'utf8')
}

// Slices out `const HIGH_KINDS = ...` through the closing `}` of `const codeRisk = (spec) => { ... }`,
// located by exact anchor lines (not a first-occurrence scan for an unrelated mention — HIGH_KINDS,
// HIGH_REF and codeRisk are each declared exactly once in this file, so their own declaration lines ARE
// the thing being extracted, unlike a wiring assertion which must find a CALL somewhere else in the file).
export function extractRiskRouterSource(text) {
  const startAnchor = "const HIGH_KINDS = new Set(['schema', 'infra'])"
  const startIdx = text.indexOf(startAnchor)
  if (startIdx < 0) throw new Error('HIGH_KINDS declaration not found')
  const fnAnchor = 'const codeRisk = (spec) => {'
  const fnIdx = text.indexOf(fnAnchor, startIdx)
  if (fnIdx < 0) throw new Error('codeRisk declaration not found after HIGH_KINDS')
  const braceOpen = text.indexOf('{', fnIdx)
  let depth = 0, i = braceOpen
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return text.slice(startIdx, i)
}

// Evaluates the extracted declarations and returns { HIGH_KINDS, HIGH_REF, codeRisk }.
export function loadRiskRouter() {
  const src = extractRiskRouterSource(readBuildSpecText())
  // eslint-disable-next-line no-new-func
  const factory = new Function(src + '\nreturn { HIGH_KINDS, HIGH_REF, codeRisk }')
  return factory()
}

export const readWorkflowText = readImplementText
export { extractBlock }

// Every decision function name declared inside the fix-loop sentinel block as of the base commit this task
// starts from, plus the two this task adds (changeScopedCriteria, testFileBasename).
export const ALL_DECISION_NAMES = [
  'scopeOf', 'scopeTargets', 'nextLenses', 'lensesToRun', 'roundBudget', 'taskCeiling', 'lensStreaks',
  'stuckLens', 'graceRound', 'emptyDiffAction', 'shouldEscalate', 'surfaceRef', 'withinOwned', 'boundaryCheck',
  'criteriaScope', 'citedCriteria', 'isForeignCriterionFinding', 'stripForeignFindings', 'routeFinding',
  'fixOutcome', 'disputesToJudge', 'widenTestsRef', 'resolveRound', 'roundOutcome', 'testRepairTarget',
  'unlandedRepairs', 'repairOwners', 'isMutualWait', 'boundaryRepair', 'unaccountedTestFiles', 'testValidity',
  'citesFailingTest', 'fixRefused', 'testSetDirOf', 'dirOf', 'resolveSpecifier', 'anchorAtArtifacts',
  'escapingImports', 'changeScopedCriteria', 'testFileBasename',
]

export function loadAllFixLoopDecisions() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  const returnObj = `return { ${ALL_DECISION_NAMES.join(', ')} }`
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + returnObj)
  return factory()
}
