# .artifacts/ — the artifact store

Everything large that a contract points at lives here and crosses edges **by ref only**. A ref is a repo-relative path, e.g. `.artifacts/diffs/t1.r0.patch`. Nothing in this directory is committed except this file.

| Kind | Path | Written by | Read by |
|---|---|---|---|
| `diffs` | `.artifacts/diffs/<task>.r<round>[.<finding>].patch` | Implementer, Fixer, Patch Merger | lenses, Test Runner, Integrator |
| `tests` | `.artifacts/tests/<task>/` | Test Author | Test Runner, Correctness lens |
| `results` | `.artifacts/results/<task>.r<round>.json` | Test Runner | Correctness lens |
| `worktrees` | `.artifacts/worktrees/<task>/` | Implementer (`git worktree add`) | Fixer, Test Runner, Integrator |
| `integration` | `.artifacts/integration/<run_id>.json` | Integrator | Evidence Assembler |
| `traces` | `.artifacts/traces/<run_id>-<workflow>.jsonl` | `ledger append --journal` | Plant Maintenance |
| `specs` | `.artifacts/specs/<spec_id>.json` | main session, from a `/build-spec` return | Implementer, Test Author, lenses, Release Notes Writer (by `spec_ref`) |
| `ci` | `.artifacts/ci/<project>-<run_id>.json` | CI Setup (`/create-project`) | Workspace.ci_ref |
| `launch` | `.artifacts/launch/<rc>/` (worktree), `<rc>.suite.json`, `<run_id>.notes.md` | Preflight artifact check, Release Notes Writer | ReviewPackage |
| `deploy` | `.artifacts/deploy/<project>/<env>/` (worktree), `<env>.json` (Deployment), `<env>.log`, `status.json`, `watch/<rc>.r<n>.jsonl` | `substrate/deploy.js` | `/deploy`, Post-launch Watch, Recorder |
| `misc` | `.artifacts/misc/<name>` | anyone | anyone |

CLI (from the repo root):

```
node substrate/artifacts.js write <kind> <name> [--from <file>]   # stdin or --from; prints the ref
node substrate/artifacts.js read  <ref>
node substrate/artifacts.js path  <ref>
node substrate/artifacts.js ls    [kind]
```

Agents may also write directly with normal file tools at the paths above; the CLI exists so the convention has one implementation and refs can be checked for escaping the root.
