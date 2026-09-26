// Shared helper for the b8- TestSet (spec-wi-b8-tests-run-the-task-code / wi-b8-impl-escaping-imports).
//
// Loads escapingImports directly from the fix-loop decisions sentinel block in build-implement.js, the
// same way substrate/test/extract-fixloop.js's loadFixLoopDecisions loads the pre-existing seventeen
// functions (AC-1 requires escapingImports be ADDED to that same block, and that block's own
// extractBlock/BEGIN_SENTINEL/END_SENTINEL machinery is reused here, unmodified, rather than
// reinvented). extract-fixloop.js itself is out of scope to edit, so this is a small ADDITIONAL loader
// living beside it in this TestSet rather than a change to it.
import { readWorkflowText, extractBlock } from './extract-fixloop.js'

// Returns the raw block text between the sentinel lines (or throws), so AC-1's own "still evaluates
// without error" and "uses no forbidden construct" checks can inspect the TEXT directly, not just the
// evaluated function.
export function fixLoopBlockText() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  return block
}

// Evaluates the sentinel block exactly as AC-1 prescribes (new Function(block + 'return { escapingImports }'))
// and returns escapingImports itself.
export function loadEscapingImports() {
  const block = fixLoopBlockText()
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + 'return { escapingImports }')
  const { escapingImports } = factory()
  if (typeof escapingImports !== 'function') throw new Error('escapingImports was not exposed by the sentinel block')
  return escapingImports
}
