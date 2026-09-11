// Shared path helper for the t2-agent-documentation TestSet
// (spec-wi-owned-surfaces-boundary, AC-13 and AC-17).
//
// Named t2-doc-paths.js (not helpers.js or fixloop-helpers.js) because both those
// names are already used by other TestSets under substrate/test/, and the landing
// step refuses to overwrite an existing file — a landed test whose helper got
// skipped would silently resolve to the wrong module. This file only resolves
// paths to the three markdown files task t2 owns; it does not touch, import, or
// evaluate .claude/workflows/build-implement.js or substrate/test/extract-fixloop.js,
// which belong to a sibling task.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repository root, two levels up from substrate/test/ once landed.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const LENS_SPEC_CONFORMANCE_MD_PATH = path.join(REPO, '.claude', 'agents', 'lens-spec-conformance.md')
export const LENS_CORRECTNESS_MD_PATH = path.join(REPO, '.claude', 'agents', 'lens-correctness.md')
export const IMPLEMENTER_MD_PATH = path.join(REPO, '.claude', 'agents', 'implementer.md')
