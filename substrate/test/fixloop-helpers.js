import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repository root, two levels up from substrate/test/.
//
// The TestSet this came from hardcoded the worktree it was authored in
// (.artifacts/worktrees/task-wi-opp-p5-4-1), which is gitignored and dies with the container — the same
// disease as WorkItem.branch and EvidenceBundle.artifact_ref. A landed test must resolve against the
// repository it now lives in, never against the scratch directory it was born in.
//
// Named fixloop-helpers.js rather than helpers.js because substrate/test/helpers.js already exists and
// means something else; the landing step refuses to overwrite it, which is correct, but a landed test whose
// helper is skipped resolves its import to the WRONG module and breaks. Renaming is the resolution.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
