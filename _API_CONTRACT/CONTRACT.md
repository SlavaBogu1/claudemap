# Indexer ↔ Visualizer API Contract

**Owner:** Indexer team. **Version:** v1.9.
Golden copy — the Visualizer reads this file directly; never copy it into `visualizer/`.
Change workflow: `REQUIREMENTS/PRODUCT_OWNER_PROCESS.md` § Contract Change Workflow.

## Status
Sprint 1 (CR-CORE-01, CR-API-01, CR-CORE-02) implemented, plus hotfix `CR-API-02` (CORS, see below),
Sprint 2's `CR-UI-06` session detail endpoint, Sprint 3's `CR-UI-07` (session count fields) and
`CR-UI-08` (notes + content endpoints, see below), Sprint 5's `CR-UI-15` (Agent Path field +
Agent/Tool content endpoints), `CR-UI-25` (project content endpoint), and `CR-UI-28`
(`hasNotedDescendant` aggregate), and Sprint 6's `CR-CORE-03` (claude-map notes, see below). All
endpoints below are backed by an Express app bound to `127.0.0.1` only, port `4317`
(`REQUIREMENTS/SHARED_CONSTANTS.md`). Every `GET` endpoint triggers an incremental, mtime-based
rescan (D13) before reading `index.db`, so responses reflect on-disk changes without a separate
poll/rescan endpoint being required yet.

Bookmarks/links (D14) are not implemented yet — that's a later CR. `annotations.db` holds persisted
custom scan roots (D20), user-authored notes attached to a graph node (`CR-UI-08`, see `notes` table
below), and, as of `CR-CORE-03`, ingest-written "claude-map" notes (see `claude_map_notes` table
below).

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
    "touchedMemory": true,
    "memoryTouchCount": 1,   // (v1.4, CR-UI-07) COUNT(*) over session_memory_touches for this session
    "toolResultCount": 1,    // (v1.4, CR-UI-07) COUNT(*) over tool_result_overflows for this session
    "hasNotedDescendant": true // (v1.8, CR-UI-28) true if this session or any of its subagent/
                                // memory-touch/tool sub-items has a saved note (see Notes below) —
                                // computed even for a session that has never been drilled down into
                                // via .../detail, so the client doesn't need to eagerly expand every
                                // session just to know whether to show the note badge on it.
  }
]
```
`touchedMemory` is unchanged (still the boolean derived the same way) — kept for backward
compatibility alongside the new integer counts; no existing client field/shape was removed.

**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

### `GET /api/projects/:id/sessions/:sessionId/detail` (v1.3, CR-UI-06)
Returns one session's substructure — the subagents it ran, the specific memory file(s) it touched, and
the tool calls whose results overflowed to disk — for drill-down beyond the aggregate
`subagentCount`/`touchedMemory` fields on `GET /api/projects/:id/sessions`. Read-only, backed by
`index.db`. `:id` = a project id from `GET /api/projects`; `:sessionId` = a session id from
`GET /api/projects/:id/sessions`.

**Response 200** — `SessionDetail`:
```jsonc
{
  "subagents": [
    {
      "agentId": "sub1",
      "agentType": "general-purpose",
      "description": "Refactor helper",
      "filePath": "D:\\...\\session-bbb\\subagents\\agent-sub1.jsonl" // (v1.6, CR-UI-15) "Agent Path" —
        // the subagent's own transcript file when one exists on disk (confirmed always present for
        // real subagent data, per the dev team's on-disk investigation), else its .meta.json path as
        // a fallback — never null/placeholder for a subagent that was discovered at all.
    }
  ],
  "memoryTouches": [
    { "filePath": "D:\\...\\memory\\topic1.md", "name": "Auth Notes" } // name: null if unparsed/unknown
  ],
  "overflows": [
    { "toolUseId": "toolu_big1", "filePath": "D:\\...\\session-bbb\\tool-results\\toolu_big1.txt" }
  ]
}
```
A session with no subagents, memory touches, or overflows returns all three arrays empty — not an
error.

**Response 404** (unknown `:id` or unknown `:sessionId` within that project):
`{ "error": "Unknown project id: <id>" }` or `{ "error": "Unknown session id: <sessionId>" }`

### `POST /api/projects/:id/open-folder`
**Side-effecting** — the one endpoint on this local-only API with a side effect. Launches the OS
file explorer at the project's resolved real folder path (Windows: `explorer.exe "<path>"`).

**Response 200:** `{ "ok": true }`
**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }` — no launch attempted.

### `GET /api/projects/:id/sessions/:sessionId/content` (v1.5, CR-UI-08)
Returns one session's readable conversation text — user/assistant turns only. Read-only, parses the
session's `.jsonl` directly (not cached in `index.db`). `tool_use`/`tool_result` content blocks are
skipped (already represented structurally via `GET .../detail`, not re-served here as raw text); a
message with no extractable text (e.g. an assistant turn that is only a tool call) is omitted
entirely, not returned as an empty string.

**Response 200** — `{ messages: SessionContentMessage[] }`:
```jsonc
{
  "messages": [
    { "role": "user", "text": "Let's refactor the auth module.", "timestamp": "2026-06-02T09:00:00.000Z" },
    { "role": "assistant", "text": "Sure, let's do it.", "timestamp": "2026-06-02T09:01:00.000Z" }
  ]
}
```

**Response 404** (unknown `:id` or `:sessionId`): same shape as `GET .../detail` above.

### `GET /api/projects/:id/memory-content?path=<filePath>` (v1.5, CR-UI-08)
Returns the raw text of one memory file. **Security requirement, non-negotiable:** `path` is
validated against that project's known `memory_files.file_path` values (a DB lookup against
`index.db`) *before* anything is read from disk — an arbitrary filesystem path is never read
directly from a query parameter, even one that happens to exist on disk.

**Response 200:** `{ "content": "---\nname: Auth Notes\n...\nAuth refactor notes body." }`

**Response 400** (missing `path`, or `path` isn't an indexed memory file for `:id`):
`{ "error": "'<path>' is not a known memory file for project '<id>'." }`

**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

### `GET /api/projects/:id/agent-content?path=<filePath>` (v1.6, CR-UI-15)
Returns one subagent's readable content, mirroring `.../sessions/:sessionId/content`'s shape.
**Security requirement, non-negotiable:** `path` is validated against that project's known
`subagents.file_path` values (a DB lookup against `index.db`, joined through `sessions` on
`project_id`) *before* anything is read from disk — same pattern as `memory-content`.

If `path` points to the subagent's own transcript (`.jsonl`, the common case per the on-disk
investigation — real subagent data always has one), the response reuses
`.../sessions/:sessionId/content`'s message-extraction parser against it. If `path` instead points to
a `.meta.json` (only possible if no separate transcript file existed on disk at index time — the
subagent's `filePath` field falls back to it, see `.../detail` above), the response synthesizes a
single message from that file's `description` field so the response shape is uniform either way.

**Response 200** — `{ messages: SessionContentMessage[] }` (same shape as
`.../sessions/:sessionId/content`):
```jsonc
{
  "messages": [
    { "role": "user", "text": "You are a helper agent...", "timestamp": "2026-06-02T09:01:30.000Z" },
    { "role": "assistant", "text": "Done — auth module refactored.", "timestamp": "2026-06-02T09:01:45.000Z" }
  ]
}
```

**Response 400** (missing `path`, or `path` isn't a known subagent file for `:id`):
`{ "error": "'<path>' is not a known subagent file for project '<id>'." }`

**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

### `GET /api/projects/:id/tool-content?path=<filePath>` (v1.6, CR-UI-15)
Returns the raw text of one tool-result overflow file — identical treatment to `memory-content`
(plain read-only text, no parsing). **Security requirement, non-negotiable:** `path` is validated
against that project's known `tool_result_overflows.file_path` values (a DB lookup against
`index.db`, joined through `sessions` on `project_id`) *before* anything is read from disk.

**Response 200:** `{ "content": "Full overflow content that was too large to inline...." }`

**Response 400** (missing `path`, or `path` isn't a known tool result file for `:id`):
`{ "error": "'<path>' is not a known tool result file for project '<id>'." }`

**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

### `GET /api/projects/:id/content` (v1.7, CR-UI-25)
Returns project-level content for the project node itself, resolved server-side in priority order:
`README.md` → `CLAUDE.md` → the earliest session's first `role: "user"` message → none. `README.md`/
`CLAUDE.md` are read directly under the project's resolved real folder (`getProjectPath(db, id)`,
already validated at discovery time via a session's own `cwd` field — not a user-supplied path, so
no additional path-validation surface is introduced here).

**Response 200** — `ProjectContent`:
```jsonc
{ "source": "readme", "content": "# My Project\n..." }
```
`source` is one of the fixed enum values `"readme" | "claude-md" | "first-message" | "none"`.
`content` is `null` only when `source` is `"none"` (no `README.md`, no `CLAUDE.md`, and zero
sessions for the project) — otherwise always the resolved text, never an error state.

**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

### Notes (v1.5, CR-UI-08)
User-authored notes attached to any graph node, persisted in `annotations.db` (durable user data,
D16) — untouched by an `index.db` rescan/rebuild. `:nodeType` is one of a fixed vocabulary used
across the graph: `session` | `memoryTouch` | `subagent` | `tool` | `project`. `:nodeId` is that
node's id (e.g. a session id, a memory file path, a subagent's `agentId`, a `toolUseId`, or a
project id).

`NoteEntry`:
```jsonc
{
  "projectId": "D--Fixture--ProjectOne",
  "nodeType": "session",
  "nodeId": "session-bbb",
  "content": "Revisit this refactor before the release.",
  "format": "markdown",
  "createdAt": "2026-07-03T12:00:00.000Z",
  "updatedAt": "2026-07-03T12:00:00.000Z"
}
```

#### `GET /api/projects/:id/notes`
**Response 200:** `NoteEntry[]` — every note for the project (possibly empty).
**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

#### `PUT /api/projects/:id/notes/:nodeType/:nodeId`
Upsert — creates the note if absent, otherwise updates it in place (no duplicate row; primary key
is `(project_id, node_type, node_id)`). `created_at` is preserved across updates; `updated_at`
always reflects the write just made.

**Request body:** `{ "content": "...", "format"?: "markdown" }` (`format` defaults to `"markdown"`
if omitted).
**Response 200:** the saved `NoteEntry`.
**Response 400** (missing/empty `content`): `{ "error": "Request body must include a non-empty string 'content'." }`
**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

#### `DELETE /api/projects/:id/notes/:nodeType/:nodeId`
**Response 204** (no body) if a note existed and was deleted.
**Response 404** (no note existed for that `nodeType`/`nodeId`, or unknown `:id`): `{ "error": "..." }`
— never a crash on a repeated delete.

### Claude-map notes (v1.9, `CR-CORE-03`)
The "claude-map" tagging skill (invoked by the user inside any live Claude Code session, e.g.
`/claude-map <text>`) posts a literal `[claude-map] <text>` marker message into that session's
transcript as an ordinary user-turn message — no live/networked mechanism, just transcript content
the Indexer picks up on its next scan like everything else it parses. Every `[claude-map]` marker
found in one session is concatenated into a **single, aggregated, view-only note** for that session
as a whole (no per-message anchor, no new node type — always `nodeType: "session"`), persisted in a
dedicated `claude_map_notes` table in `annotations.db` (durable user data, D16) that is entirely
separate from the user-editable `notes` table (`CR-UI-08`) — the two never collide or overwrite each
other. Unlike `notes`, this content has **no client-facing write path** — it is written only during
the server's ingest/rescan pass, replacing a session's row wholesale each time that session is
re-parsed (safe: no user edits exist here to lose). There is accordingly no `PUT`/`DELETE` for this
resource, only a read endpoint.

`ClaudeMapNoteEntry`:
```jsonc
{
  "projectId": "D--Fixture--ProjectOne",
  "nodeType": "session",
  "nodeId": "session-bbb",
  "content": "First tagged moment.\n\nSecond tagged moment.",
  "createdAt": "2026-07-03T12:00:00.000Z",
  "updatedAt": "2026-07-03T12:05:00.000Z"
}
```
Note there is no `format` field here (unlike `NoteEntry`) — this content is always plain concatenated
marker text, never a user-chosen format.

#### `GET /api/projects/:id/claude-map-notes`
**Response 200:** `ClaudeMapNoteEntry[]` — one entry per session that has at least one `[claude-map]`
marker (possibly empty for a project with none).
**Response 404** (unknown `:id`): `{ "error": "Unknown project id: <id>" }`

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

(the Visualizer's Vite dev server default port). Allowed methods: `GET`, `POST`, `PUT`, `DELETE`
(`PUT`/`DELETE` added v1.5 for the notes endpoints). Allowed request header: `Content-Type` (needed
for the JSON body on `POST /api/projects/browse`, `POST /api/projects/:id/open-folder`, and
`PUT /api/projects/:id/notes/:nodeType/:nodeId`). Requests with no `Origin` header (curl,
server-to-server) are unaffected — CORS is a browser-enforced, cross-origin-only concept.

**Why not a wildcard:** this API is local-only but side-effecting (`open-folder` launches the OS
file explorer; `browse` adds a persisted scan root; the notes endpoints create/update/delete
durable user data) and its responses include real filesystem paths. A wildcard would let *any*
website's JavaScript running in the user's browser read those paths and trigger those endpoints —
a CSRF-adjacent disclosure risk. The allowlist keeps this to known Visualizer origins only.

**Extending the allowlist:** when a built static Visualizer is served from a fixed origin (e.g. a
future packaged desktop shell), add that origin to `ALLOWED_ORIGINS` in `indexer/src/config.ts` —
it's a plain array, no other code changes needed.

## Changelog
- **v1.9** (2026-07-03, Sprint 6, `CR-CORE-03`) — Added `GET /api/projects/:id/claude-map-notes`
  (read-only; no `PUT`/`DELETE` — this content has no client-facing write path). Backed by a new
  `claude_map_notes` table in `annotations.db` (durable user data, D16), separate from and never
  colliding with the `notes` table (`CR-UI-08`). Ingest-time only: during the existing session
  transcript parsing pass, every `[claude-map] <text>` marker message found is concatenated into a
  single row keyed `(projectId, "session", sessionId)`, replaced wholesale on each rescan that
  re-parses that session (safe — no user-edit path exists for this table to collide with). No changes
  to any existing endpoint/schema; CORS allowlist/methods unchanged (this is a `GET`, already
  covered).
- **v1.8** (2026-07-03, Sprint 5, `CR-UI-28`) — Added `hasNotedDescendant` boolean field to
  `GET /api/projects/:id/sessions`'s response — true if the session itself or any of its subagent/
  memory-touch/tool sub-items has a saved note in `annotations.db`'s `notes` table. Computed in
  application code (never a SQL-level join across `index.db`/`annotations.db`, D16) so a collapsed
  session that has never been drilled down into via `.../detail` can still show the note-badge
  indicator. No changes to any existing endpoint/schema.
- **v1.7** (2026-07-03, Sprint 5, `CR-UI-25`) — Added `GET /api/projects/:id/content` (project-level
  content: `README.md` → `CLAUDE.md` → earliest session's first user message → `{source: "none",
  content: null}`). Reuses `sessionContent.ts`'s existing message-extraction parser for the
  first-message fallback case. No changes to any existing endpoint/schema.
- **v1.6** (2026-07-03, Sprint 5, `CR-UI-15`) — Added a `filePath` field ("Agent Path") to
  `GET /api/projects/:id/sessions/:sessionId/detail`'s subagent entries — the subagent's own
  transcript file when one exists on disk (confirmed always present for real subagent data via the
  dev team's on-disk investigation against fixture + production Sudoku/Terraza projects), else its
  `.meta.json` path as a fallback. Added `GET /api/projects/:id/agent-content?path=<filePath>`
  (subagent content, reuses the session-content parser for a transcript or synthesizes a message
  from `.meta.json`'s `description` for the fallback case) and
  `GET /api/projects/:id/tool-content?path=<filePath>` (raw tool-output text, identical treatment to
  `memory-content`) — both validate `path` against a known file reference for that project (a new
  `subagents.file_path` column / the existing `tool_result_overflows.file_path`) before ever
  touching disk, same security pattern as `memory-content`. No changes to any existing
  endpoint/schema beyond the additive `filePath` field.
- **v1.5** (2026-07-03, Sprint 3, `CR-UI-08`) — Added `GET /api/projects/:id/sessions/:sessionId/content`
  (readable user/assistant text turns for a session, parsed directly from the `.jsonl`, not cached),
  `GET /api/projects/:id/memory-content?path=<filePath>` (raw memory-file text; validates `path`
  against `index.db`'s `memory_files.file_path` before ever touching disk — never reads an arbitrary
  query-param path), and a `notes` CRUD trio — `GET /api/projects/:id/notes`,
  `PUT /api/projects/:id/notes/:nodeType/:nodeId` (upsert), `DELETE /api/projects/:id/notes/:nodeType/:nodeId`
  — backed by a new `notes` table in `annotations.db` (durable user data, D16; untouched by an
  `index.db` rescan/rebuild). CORS allowed methods extended to include `PUT`/`DELETE` for the notes
  endpoints (see § CORS Policy). No changes to any existing endpoint/schema.
- **v1.4** (2026-07-03, Sprint 3, `CR-UI-07`) — Added `memoryTouchCount` and `toolResultCount`
  integer fields to `GET /api/projects/:id/sessions`'s response (`COUNT(*)` over
  `session_memory_touches` / `tool_result_overflows` grouped by `session_id`). The existing
  `touchedMemory` boolean is unchanged — purely additive, no existing field removed or retyped.
- **v1.3** (2026-07-03, Sprint 2, `CR-UI-06`) — Added
  `GET /api/projects/:id/sessions/:sessionId/detail` (subagents, memory touches, tool-result
  overflows for one session). Backed by a new additive `session_memory_touches` join table
  (`indexer/src/db/indexDb.ts`) that persists the specific `memory/`-path target of each
  `Write`/`Edit` tool_use the session parser already detects when computing the existing
  `touched_memory` flag — no changes to any existing endpoint/schema.
- **v1.2** (2026-07-03, hotfix `CR-API-02`) — Added CORS support: explicit origin allowlist (see §
  CORS Policy above). No endpoint/schema changes — this is transport-layer only, fixing real
  cross-origin browser access that the Sprint 1 in-process/mocked test suites couldn't catch.
- **v1.1** (2026-07-02) — Added `POST /api/projects/browse` (CR-CORE-02/D20); documented that
  `GET /api/projects` now scans/returns projects from all known roots (default + persisted custom
  roots), not just the default root.
- **v1.0** (2026-07-02) — Finalized Sprint 1 endpoints (CR-CORE-01/CR-API-01): `GET /api/projects`,
  `GET /api/projects/:id/sessions`, `POST /api/projects/:id/open-folder`.
- **v0.1** (2026-07-02) — skeleton created at bootstrap; no endpoints yet.
