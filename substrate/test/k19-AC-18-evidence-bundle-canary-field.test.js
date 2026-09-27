// spec-wi-b1-b2-memory-to-build AC-18. Written from the Spec only.
//
// "the returned EvidenceBundle" / "a run completes" / "it carries a per-task canary record, for example
// canaries: [{ task_id, canary_source: 'library'|'args'|'none', canary_id? }]. canary_id is present for
// 'library' and omitted or null otherwise. The field is additive and every existing field keeps its
// shape."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkflowText } from './extract-fixloop.js'
import { codeMask, matchBrace, enclosingFunction } from './b5-wiring-helpers.js'

// The final, top-level `return { ... }` — the EvidenceBundle build-implement.js returns (never nested
// inside any named function; the LAST such top-level return in the file, since a couple of early-exit
// `return { refused: true, ... }` script-level guards appear earlier).
function evidenceBundleReturn(text) {
  const mask = codeMask(text)
  const re = /\breturn\s*\{/g
  let m
  const topLevel = []
  while ((m = re.exec(text))) {
    if (!mask[m.index]) continue
    try { enclosingFunction(text, m.index) } catch { topLevel.push(m.index) }
  }
  assert.ok(topLevel.length > 0, 'expected at least one top-level return { in build-implement.js')
  const idx = topLevel[topLevel.length - 1]
  const braceStart = text.indexOf('{', idx)
  const braceEnd = matchBrace(text, braceStart)
  return text.slice(braceStart, braceEnd)
}

test('AC-18: the EvidenceBundle return carries an additive canaries field, per-task, alongside existing fields', () => {
  const text = readWorkflowText()
  const ret = evidenceBundleReturn(text)
  assert.match(ret, /\bcanaries\s*:/, 'expected the EvidenceBundle to carry a canaries field')
  // Existing fields must still be present (additive, not replaced).
  for (const field of ['panel_results', 'escalations', 'tests_landed', 'tests_skipped', 'spend', 'provenance']) {
    assert.match(ret, new RegExp(`\\b${field}\\s*[:,}]`), `expected the pre-existing field ${field} to still be present`)
  }
  assert.match(ret, /canary_source/, 'expected the canaries entries to carry canary_source')
})
