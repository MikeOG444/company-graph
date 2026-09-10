# toy — the throwaway venture

A tiny in-memory items API. Exists so the production line has something to build against before venture 1.

Routes: `GET /health`, `GET /items`, `POST /items`, `GET /items/:id`.

`GET /items` runs a filter -> sort -> cap pipeline over the store and accepts
two optional query parameters:

- `?sort=name|id` — `name` orders by a plain code-unit string comparison (no
  locale, no case folding), `id` and an absent `sort` both keep insertion
  order. Any other present value, including an empty, differently-cased,
  padded or repeated one, returns `400 { "error": "invalid sort" }`.
- `?limit=N` — caps the response at `N` items, where `N` is a canonical
  positive decimal integer within safe-integer range. A missing `limit`
  returns every item. An invalid `limit` (zero, negative, non-canonical, out
  of safe-integer range, or repeated) returns
  `400 { "error": "invalid limit" }`.

The cap is applied last, so `?sort=name&limit=2` returns the two
alphabetically first items, not the first two in insertion order. Unknown
query parameters are ignored, and a rejected request leaves stored data
unchanged.

An `Item` is `{ id, name, tags, created_at }`: `tags` is an optional array of
up to 10 strings of 1-32 characters supplied on `POST /items` (default `[]`,
`400 { "error": "invalid tags" }` otherwise), and `created_at` is a
server-generated ISO-8601 UTC timestamp fixed at creation.

Any request matching no route answers `404 { "error": "not found" }` in JSON
rather than Express's HTML default. Every answered request writes one line to
stdout, `METHOD PATH STATUS ELAPSED_MS`, unless `NODE_ENV=test` (which the
`npm test` script sets, so the suite's output stays clean).

```
cd toy && npm install && npm test
```

Paths in specs, tasks and surfaces are relative to the repository root (e.g. `toy/src/app.js`). Worktrees are of the repository, so a worktree at `.artifacts/worktrees/<task>/` contains this app at `.artifacts/worktrees/<task>/toy/`.
