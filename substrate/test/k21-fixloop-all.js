// k21d: the k21 TestSet's loader for EVERY top-level function in the fix-loop decisions block. The Test Author put it
// in its copy of extract-fixloop.js; the lander keeps the repo's copy, so it lands here under its own name.
import { readWorkflowText, extractBlock } from './extract-fixloop.js'

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
