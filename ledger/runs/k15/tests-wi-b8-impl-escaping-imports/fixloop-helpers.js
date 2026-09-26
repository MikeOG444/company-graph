import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repository root — resolved from process.cwd(), NEVER by counting ".." segments from this file's own
// location.
//
// This TestSet is authored under .artifacts/tests/implement-test-validity-classification/, which is
// gitignored and dies with the container (CLAUDE.md's runtime note on .artifacts/). Worse, per
// spec-wi-b6-test-validity-before-blame's own framing, during the fix loop's per-round Test Runner this
// file's physical location never even changes: the Test Runner runs the tests AT this artifact path
// while pointed AT the task's worktree (build-implement.js: "Run the tests at ${tests_ref} against the
// app at ${wt}/${APP}/ ... npm ci there first"), i.e. it changes into the worktree and invokes the test
// runner from there. So process.cwd() at test-run time is the worktree root (or, once landed, the
// repository root a plain `npm test` is invoked from) — counting ".." from import.meta.url instead
// resolves against wherever this FILE happens to sit (the committed pre-task repo, an unrelated
// worktree, or nothing at all), never against the tree whose contracts.schema.json / COMPANY.md /
// .claude/workflows/build-implement.js actually contain the change under test. That was the defect: it
// always pointed at the pre-task commit and none of testValidity, citesFailingTest, fixRefused,
// behaviour_changed or the b5-wiring-helpers rules existed there.
//
// Walk up from cwd (not sideways from this file) until BOTH repo markers are found, exactly like the
// existing substrate/test/graph-lint-helpers.js findRepoRoot — reused here rather than reinvented, per
// CLAUDE.md rule 3, because a hardcoded number of "up" hops breaks the moment this file's own depth
// below the repo root differs between where it is authored and where it is run.
//
// Named fixloop-helpers.js rather than helpers.js because substrate/test/helpers.js already exists and
// means something else; the landing step refuses to overwrite it, which is correct, but a landed test whose
// helper is skipped resolves its import to the WRONG module and breaks. Renaming is the resolution.
//
// Integration k11: cwd is searched FIRST (the fix-loop case above), but a suite invoked from outside any
// repository (e.g. `node --test /abs/path/substrate/test/x.test.js` from /tmp) previously resolved fine by
// file location, so when no repo lies above cwd we fall back to walking up from this file's own directory —
// still by marker files, never by a fixed count of ".." hops.
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'contracts.schema.json')) && fs.existsSync(path.join(dir, 'COMPANY.md'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = findRepoRoot(process.cwd()) ?? findRepoRoot(HERE)
if (!REPO) throw new Error(`repository root not found above ${process.cwd()} or ${HERE}`)
