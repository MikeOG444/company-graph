// spec-wi-b8-tests-run-the-task-code AC-10. Written from the Spec only.
//
// "The final run output object built at the end of build-implement.js. Its keys are inspected. It has an
// import_escapes array of { round, file, specifier } entries, one per escaping import recorded across every
// task. The array is [] when no round saw an escape."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'

test('AC-10: the final run output declares an import_escapes: [] entry, of { round, file, specifier } shape', () => {
  const text = readWorkflowText()
  // Anchor on the existing phase('Evidence') marker and the final return statement it precedes, the same
  // shape the pre-existing test_validity / boundary_repairs entries sit beside.
  const phaseIdx = text.indexOf("phase('Evidence')")
  assert.ok(phaseIdx > 0, "expected the phase('Evidence') marker before the final run output")
  const returnIdx = text.indexOf('return {', phaseIdx)
  assert.ok(returnIdx > phaseIdx, 'expected the final run output object literal after phase(\'Evidence\')')
  const closeIdx = text.indexOf('provenance: stamp(', returnIdx)
  assert.ok(closeIdx > returnIdx, 'expected the run output to still stamp provenance')
  const block = text.slice(returnIdx, closeIdx + 400)

  assert.match(block, /import_escapes\s*:/, 'expected an import_escapes key on the final run output')
  // The value must be built from every task's own escaping-import records, mirroring how test_validity is
  // built from finished.flatMap(f => f.testValidity ?? []) — some per-task array, flattened, defaulting to [].
  const importEscapesLine = block.match(/import_escapes\s*:\s*([^\n]*)/)?.[1] ?? ''
  assert.match(importEscapesLine, /flatMap|\?\?\s*\[\]/, 'import_escapes must be built from every task\'s records, defaulting to []')
})

test('AC-10: import_escapes entries are documented (or shaped) as { round, file, specifier }', () => {
  const text = readWorkflowText()
  const phaseIdx = text.indexOf("phase('Evidence')")
  const returnIdx = text.indexOf('return {', phaseIdx)
  const closeIdx = text.indexOf('provenance: stamp(', returnIdx)
  const block = text.slice(Math.max(0, returnIdx - 500), closeIdx + 400)
  const importEscapesIdx = block.indexOf('import_escapes')
  assert.ok(importEscapesIdx >= 0, 'expected import_escapes in the run output region')
  const window = block.slice(Math.max(0, importEscapesIdx - 300), importEscapesIdx + 300)
  for (const field of ['round', 'file', 'specifier']) {
    assert.match(window, new RegExp(`\\b${field}\\b`), `expected ${field} to be named near import_escapes`)
  }
})
