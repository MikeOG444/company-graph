# toy — the throwaway venture

A tiny in-memory items API. Exists so the production line has something to build against before venture 1.

Routes: `GET /health`, `GET /items`, `POST /items`, `GET /items/:id`.

`GET /items` accepts an optional `?limit=N` query parameter, where `N` is a
positive integer, to cap the number of items returned (the first `N` in
insertion order). A missing `limit` returns every item, unchanged from
before. An invalid `limit` (not a positive integer, out of safe-integer
range, or repeated) returns `400 { "error": "invalid limit" }` and leaves
stored data unchanged.

```
cd toy && npm install && npm test
```

Paths in specs, tasks and surfaces are relative to the repository root (e.g. `toy/src/app.js`). Worktrees are of the repository, so a worktree at `.artifacts/worktrees/<task>/` contains this app at `.artifacts/worktrees/<task>/toy/`.
