// Helper for the B2 (build-implement.js) selectCanary tests, spec-wi-b1-b2-memory-to-build.
//
// Reuses extract-fixloop.js's existing sentinel-extraction (BEGIN/END 'fix-loop decisions', the same
// idiom AC-10 itself names) rather than re-implementing it, per CLAUDE.md rule 3. Evaluates the block
// with `new Function` exactly as AC-10 describes and returns selectCanary plus withinOwned (AC-10: the
// pure function "uses withinOwned from the same block").
//
// selectCanary does not exist in the block yet at test-authoring time (this task is unbuilt); this
// helper simply asks the block, once it exists, for those two names. Until then, loading throws, which
// is the correct "not implemented yet" signal for a test written before the implementation.
import { readWorkflowText, extractBlock } from './extract-fixloop.js'

export function loadSelectCanary() {
  const { block } = extractBlock(readWorkflowText())
  if (block == null) throw new Error('fix-loop decisions block not found between the sentinel lines')
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + `
    return { selectCanary, withinOwned }`)
  return factory()
}
