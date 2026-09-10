# toy — the throwaway venture

A tiny in-memory items API. Exists so the production line has something to build against before venture 1.

Routes: `GET /health`, `GET /items`, `POST /items`.

```
cd toy && npm install && npm test
```

Paths in specs, tasks and surfaces are relative to the repository root (e.g. `toy/src/app.js`). Worktrees are of the repository, so a worktree at `.artifacts/worktrees/<task>/` contains this app at `.artifacts/worktrees/<task>/toy/`.
