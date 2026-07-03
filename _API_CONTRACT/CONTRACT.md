# Indexer ↔ Visualizer API Contract

**Owner:** Indexer team. **Version:** v1.2.
Golden copy — the Visualizer reads this file directly; never copy it into `visualizer/`.
Change workflow: `REQUIREMENTS/PRODUCT_OWNER_PROCESS.md` § Contract Change Workflow.

## Status
Sprint 1 (CR-CORE-01, CR-API-01, CR-CORE-02) implemented, plus hotfix `CR-API-02` (CORS, see below).
All endpoints below are backed by an Express app bound to `127.0.0.1` only, port `4317`
(`REQUIREMENTS/SHARED_CONSTANTS.md`). Every `GET` endpoint triggers an incremental, mtime-based
rescan (D13) before reading `index.db`, so responses reflect on-disk changes without a separate
poll/rescan endpoint being required yet.

Bookmarks/links (D14) are not implemented in Sprint 1 — that's a later CR. `annotations.db` today
only holds persisted custom scan roots (D20).

## Endpoints

### `GET /api/projects`
Lists all projects found across every known root: the default `{CLAUDE_HOME}/projects` root plus
any custom roots persisted via `POST /api/projects/browse` (D20). Read-only, backed by `index.db`.

**Response 200** — `ProjectEntry[]`:
```jsonc
[
  {
    "id": "D--Fixture--ProjectOne",   // sanitized project directory name (verbatim, not decoded)
    "path": "D:\\Fixture\\ProjectOne", // resolved real, unsanitized folder (from a session's cwd field)
    "sessionCount": 3,
    "lastActiveAt": "2026-06-03T08:01:00.000Z" // max session endedAt, or null if no sessions yet
  }
]
```

### `GET /api/projects/:id/sessions`
Lists every top-level session for one project (`:id` = the `id` from `GET /api/projects`).
Read-only, backed by `index.db`.

**Response 200** — `SessionEntry[]`:
```jsonc
[
  {
    "id": "session-bbb",                 // session uuid (filename without .jsonl)
    "startedAt": "2026-06-02T09:00:00.000Z",
    "endedAt": "2026-06-02T09:04:00.000Z",
    "messageCount": 5,
    "gitBranch": "feature/auth-refactor",
    "preview": "Let's refactor the auth module.", // slug if present, else stripped/truncated first user message
    "subagentCount": 1,
    "touchedMemory": true
  }
]
```

**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

### `POST /api/projects/:id/open-folder`
**Side-effecting** — the one endpoint on this local-only API with a side effect. Launches the OS
file explorer at the project's resolved real folder path (Windows: `explorer.exe "<path>"`).

**Response 200:** `{ "ok": true }`
**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }` — no launch attempted.

### `POST /api/projects/browse` (v1.1, D20/CR-CORE-02)
Adds a custom scan root beyond the default `{CLAUDE_HOME}/projects`. Accepts either a path that is
itself a projects-root directory (immediate subdirectories are project folders containing top-level
`*.jsonl` files) or a path with a `projects/` subfolder that is such a root (e.g. a whole exported
`.claude`-home-like folder).

**Request body:** `{ "path": "D:\\Exported\\.claude" }`

**Response 200** (valid path; same shape as `GET /api/projects`, scoped to the newly-scanned root):
```jsonc
[{ "id": "...", "path": "...", "sessionCount": 2, "lastActiveAt": "..." }]
```

**Response 400** (path doesn't exist, isn't a directory, or has no valid session data):
`{ "error": "No valid Claude Code session data found at '<path>' (checked the path itself and a 'projects' subfolder)." }`

On success, the path is persisted to `annotations.db` (durable user data, D16) and is included in
every subsequent `GET /api/projects` call, surviving restarts.

## CORS Policy (v1.2, CR-API-02 hotfix)
The API sends `Access-Control-Allow-*` headers via an **explicit origin allowlist** — never a
wildcard `*`. Currently allowed origins (`indexer/src/config.ts` `ALLOWED_ORIGINS`):
- `http://localhost:5173`
- `http://127.0.0.1:5173`

(the Visualizer's Vite dev server default port). Allowed methods: `GET`, `POST`. Allowed request
header: `Content-Type` (needed for the JSON body on `POST /api/projects/browse` and
`POST /api/projects/:id/open-folder`). Requests with no `Origin` header (curl, server-to-server)
are unaffected — CORS is a browser-enforced, cross-origin-only concept.

**Why not a wildcard:** this API is local-only but side-effecting (`open-folder` launches the OS
file explorer; `browse` adds a persisted scan root) and its responses include real filesystem
paths. A wildcard would let *any* website's JavaScript running in the user's browser read those
paths and trigger those endpoints — a CSRF-adjacent disclosure risk. The allowlist keeps this to
known Visualizer origins only.

**Extending the allowlist:** when a built static Visualizer is served from a fixed origin (e.g. a
future packaged desktop shell), add that origin to `ALLOWED_ORIGINS` in `indexer/src/config.ts` —
it's a plain array, no other code changes needed.

## Changelog
- **v1.2** (2026-07-03, hotfix `CR-API-02`) — Added CORS support: explicit origin allowlist (see §
  CORS Policy above). No endpoint/schema changes — this is transport-layer only, fixing real
  cross-origin browser access that the Sprint 1 in-process/mocked test suites couldn't catch.
- **v1.1** (2026-07-02) — Added `POST /api/projects/browse` (CR-CORE-02/D20); documented that
  `GET /api/projects` now scans/returns projects from all known roots (default + persisted custom
  roots), not just the default root.
- **v1.0** (2026-07-02) — Finalized Sprint 1 endpoints (CR-CORE-01/CR-API-01): `GET /api/projects`,
  `GET /api/projects/:id/sessions`, `POST /api/projects/:id/open-folder`.
- **v0.1** (2026-07-02) — skeleton created at bootstrap; no endpoints yet.
