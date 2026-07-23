import Database from "better-sqlite3";
import type {
  FileHistoryRecord,
  MemoryFileRecord,
  ProjectEntry,
  ProjectGroupEntry,
  SessionDetail,
  SessionEntry,
  SubagentRecord,
  ToolResultOverflowRecord
} from "../types.js";

export type IndexDb = Database.Database;

/**
 * Open (or create) the rebuildable index.db cache and ensure its schema exists.
 * This file holds only derived/parsed data — it is always safe to delete and rebuild (D16).
 */
export function openIndexDb(filePath: string): IndexDb {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      dir_path TEXT NOT NULL,
      path TEXT,
      -- (v1.11, CR-CORE-06) 'code' (default, Claude Code projects — the only kind that existed
      -- before this column) | 'cowork' | 'chat' (Claude Desktop pseudo-projects: one row per Cowork
      -- Space or per standalone Chat session, populated by discovery/desktopRescan.ts).
      kind TEXT NOT NULL DEFAULT 'code'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      mtime_ms INTEGER NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      git_branch TEXT,
      slug TEXT,
      preview TEXT,
      touched_memory INTEGER NOT NULL DEFAULT 0,
      subagent_count INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      last_indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subagents (
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_type TEXT,
      description TEXT,
      tool_use_id TEXT,
      file_path TEXT,
      PRIMARY KEY (session_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS tool_result_overflows (
      session_id TEXT NOT NULL,
      tool_use_id TEXT,
      file_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_files (
      file_path TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      name TEXT,
      description TEXT,
      type TEXT,
      last_indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_memory_touches (
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_history_entries (
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      backup_file_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      backup_time TEXT
    );
  `);
  migrateAdditiveColumns(db);
  return db;
}

/**
 * (CR-CORE-07) `CREATE TABLE IF NOT EXISTS` above is a no-op against an already-existing table, so a
 * column added to this schema in a later sprint (e.g. `sessions.file_count` in CR-CORE-05,
 * `projects.kind` in CR-CORE-06) never actually reaches a real, pre-existing on-disk `index.db` —
 * the very first write/read against that column then crashes with an unhandled `SqliteError`
 * ("table X has no column named Y"), surfaced to every endpoint since every one rescans first (D13).
 *
 * This runs once at DB-open time, before any other code touches the DB: for every table below, check
 * its actual columns via `PRAGMA table_info` against the columns this schema version expects, and
 * `ALTER TABLE ... ADD COLUMN` for any additive column found missing. A fresh DB (just created above)
 * already has every column, so this is a no-op for it — only a genuinely older on-disk file pays the
 * (cheap, one-time) cost. Additive-only: this does not handle column removal/renaming/type changes,
 * which this schema has never needed so far.
 */
function migrateAdditiveColumns(db: IndexDb): void {
  const additiveColumns: Record<string, { name: string; ddl: string }[]> = {
    projects: [
      { name: "kind", ddl: `ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'code'` }
    ],
    sessions: [
      { name: "file_count", ddl: `ALTER TABLE sessions ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0` }
    ]
  };

  for (const [table, columns] of Object.entries(additiveColumns)) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    );
    for (const column of columns) {
      if (!existing.has(column.name)) {
        db.exec(column.ddl);
      }
    }
  }
}

export function upsertProject(db: IndexDb, id: string, root: string, dirPath: string): void {
  db.prepare(
    `INSERT INTO projects (id, root, dir_path, path) VALUES (?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET root = excluded.root, dir_path = excluded.dir_path`
  ).run(id, root, dirPath);
}

export function updateProjectPath(db: IndexDb, id: string, resolvedPath: string): void {
  db.prepare(`UPDATE projects SET path = ? WHERE id = ?`).run(resolvedPath, id);
}

/**
 * (v1.11, CR-CORE-06) Upsert a Claude Desktop pseudo-project — one row per Cowork Space
 * (`id: "cowork:<spaceId>"`) or per standalone Chat session (`id: "chat:<sessionId>"`). `root` is a
 * fixed marker (not a real scan root), distinct from any Code project's real root path, so these
 * rows can never collide with `resolveAllKnownRoots`'s Code discovery. `displayName` is the Cowork
 * Space's `name` or the Chat session's `title` — surfaced as `path` on the shared `projects` row,
 * mirroring how a Code project's `path` is its resolved real folder.
 */
export function upsertDesktopProject(
  db: IndexDb,
  id: string,
  kind: "cowork" | "chat",
  displayName: string
): void {
  db.prepare(
    `INSERT INTO projects (id, root, dir_path, path, kind) VALUES (?, 'desktop', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET path = excluded.path, kind = excluded.kind`
  ).run(id, id, displayName, kind);
}

export function getSessionMtime(db: IndexDb, filePath: string): number | null {
  const row = db.prepare(`SELECT mtime_ms FROM sessions WHERE file_path = ?`).get(filePath) as
    | { mtime_ms: number }
    | undefined;
  return row ? row.mtime_ms : null;
}

export function getMemoryFileMtime(db: IndexDb, filePath: string): number | null {
  const row = db.prepare(`SELECT mtime_ms FROM memory_files WHERE file_path = ?`).get(filePath) as
    | { mtime_ms: number }
    | undefined;
  return row ? row.mtime_ms : null;
}

/**
 * (CR-CORE-04) Every currently-indexed session id for a project — the "known before this rescan"
 * side of the diff against the on-disk `.jsonl` listing, used to detect sessions whose file has
 * since been deleted so their stale index.db rows can be pruned.
 */
export function listSessionIdsForProject(db: IndexDb, projectId: string): string[] {
  const rows = db.prepare(`SELECT id FROM sessions WHERE project_id = ?`).all(projectId) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * (CR-CORE-04) Deletes a session row and all of its child rows from index.db — `subagents`,
 * `tool_result_overflows`, `session_memory_touches` — since this schema has no FK cascade. Called
 * only when the session's backing `.jsonl` file has been confirmed gone from disk during a rescan.
 * **Never touches `annotations.db`** (D16): a user note or stick-it note on this session's id
 * survives untouched so it isn't lost if the file is later restored/renamed.
 */
export function deleteSession(db: IndexDb, sessionId: string): void {
  const del = db.transaction((id: string) => {
    db.prepare(`DELETE FROM subagents WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM tool_result_overflows WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM session_memory_touches WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM file_history_entries WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  });
  del(sessionId);
}

/**
 * (CR-CORE-04) Every currently-indexed memory file path for a project — the "known before this
 * rescan" side of the diff against the on-disk `memory/*.md` listing, used to detect memory files
 * whose file has since been deleted so their stale index.db row can be pruned.
 */
export function listMemoryFilePathsForProject(db: IndexDb, projectId: string): string[] {
  const rows = db
    .prepare(`SELECT file_path FROM memory_files WHERE project_id = ?`)
    .all(projectId) as { file_path: string }[];
  return rows.map((r) => r.file_path);
}

/**
 * (CR-CORE-04) Deletes one `memory_files` row — called only when that file has been confirmed gone
 * from disk during a rescan. `session_memory_touches` rows referencing this path are left alone
 * (owned by their session, cleaned up only when that session itself is deleted); a dangling
 * reference just resolves to `name: null` via `getSessionDetail`'s LEFT JOIN, same as any
 * touch pointing at a memory file that was never indexed. **Never touches `annotations.db`** (D16).
 */
export function deleteMemoryFile(db: IndexDb, filePath: string): void {
  db.prepare(`DELETE FROM memory_files WHERE file_path = ?`).run(filePath);
}

/**
 * (CR-CORE-08) Deletes every project row (and all of its child rows — sessions and their own
 * children, memory files) whose `root` column exactly matches `root`. Used when a custom scan root
 * is removed via `DELETE /api/projects/browse`: unlike CR-CORE-04's per-file pruning (which only
 * ever prunes sessions/memory-files *within* a root that's still being actively scanned), a root
 * that's no longer scanned at all would otherwise leave its project rows in `index.db` forever —
 * this is the direct fix for that gap, and is why `root` is matched as a plain string rather than
 * re-resolved via `resolveProjectsRoot` (a root being removed specifically because it no longer
 * resolves is the exact case this must still handle). No-op if no project has that exact root.
 * **Never touches `annotations.db`** (D16).
 */
export function deleteProjectsByRoot(db: IndexDb, root: string): void {
  const projectIds = (
    db.prepare(`SELECT id FROM projects WHERE root = ?`).all(root) as { id: string }[]
  ).map((r) => r.id);
  if (projectIds.length === 0) return;

  const del = db.transaction((ids: string[]) => {
    for (const projectId of ids) {
      const sessionIds = (
        db.prepare(`SELECT id FROM sessions WHERE project_id = ?`).all(projectId) as { id: string }[]
      ).map((r) => r.id);
      for (const sessionId of sessionIds) {
        db.prepare(`DELETE FROM subagents WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM tool_result_overflows WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM session_memory_touches WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM file_history_entries WHERE session_id = ?`).run(sessionId);
      }
      db.prepare(`DELETE FROM sessions WHERE project_id = ?`).run(projectId);
      db.prepare(`DELETE FROM memory_files WHERE project_id = ?`).run(projectId);
      db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    }
  });
  del(projectIds);
}

export interface UpsertSessionInput {
  id: string;
  projectId: string;
  filePath: string;
  mtimeMs: number;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  gitBranch: string | null;
  slug: string | null;
  preview: string | null;
  touchedMemory: boolean;
  subagentCount: number;
  /** (v1.10, CR-CORE-05) Count of unique files backed up during the session (file-history-snapshot). */
  fileCount: number;
  indexedAt: number;
}

export function upsertSession(db: IndexDb, s: UpsertSessionInput): void {
  db.prepare(
    `INSERT INTO sessions
       (id, project_id, file_path, mtime_ms, started_at, ended_at, message_count, git_branch,
        slug, preview, touched_memory, subagent_count, file_count, last_indexed_at)
     VALUES (@id, @projectId, @filePath, @mtimeMs, @startedAt, @endedAt, @messageCount, @gitBranch,
             @slug, @preview, @touchedMemory, @subagentCount, @fileCount, @indexedAt)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       file_path = excluded.file_path,
       mtime_ms = excluded.mtime_ms,
       started_at = excluded.started_at,
       ended_at = excluded.ended_at,
       message_count = excluded.message_count,
       git_branch = excluded.git_branch,
       slug = excluded.slug,
       preview = excluded.preview,
       touched_memory = excluded.touched_memory,
       subagent_count = excluded.subagent_count,
       file_count = excluded.file_count,
       last_indexed_at = excluded.last_indexed_at`
  ).run({ ...s, touchedMemory: s.touchedMemory ? 1 : 0 });
}

export function replaceSubagents(db: IndexDb, sessionId: string, records: SubagentRecord[]): void {
  db.prepare(`DELETE FROM subagents WHERE session_id = ?`).run(sessionId);
  const insert = db.prepare(
    `INSERT INTO subagents (session_id, agent_id, agent_type, description, tool_use_id, file_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const r of records) {
    insert.run(sessionId, r.agentId, r.agentType, r.description, r.toolUseId, r.filePath);
  }
}

export function replaceOverflows(db: IndexDb, sessionId: string, records: ToolResultOverflowRecord[]): void {
  db.prepare(`DELETE FROM tool_result_overflows WHERE session_id = ?`).run(sessionId);
  const insert = db.prepare(
    `INSERT INTO tool_result_overflows (session_id, tool_use_id, file_path) VALUES (?, ?, ?)`
  );
  for (const r of records) {
    insert.run(sessionId, r.toolUseId, r.filePath);
  }
}

export function replaceMemoryTouches(db: IndexDb, sessionId: string, filePaths: string[]): void {
  db.prepare(`DELETE FROM session_memory_touches WHERE session_id = ?`).run(sessionId);
  const insert = db.prepare(
    `INSERT INTO session_memory_touches (session_id, file_path) VALUES (?, ?)`
  );
  for (const filePath of filePaths) {
    insert.run(sessionId, filePath);
  }
}

/**
 * (v1.10, CR-CORE-05) Replaces a session's `file_history_entries` wholesale, one row per unique
 * file path — mirrors `replaceSubagents`/`replaceOverflows`/`replaceMemoryTouches`.
 */
export function replaceFileHistoryEntries(db: IndexDb, sessionId: string, records: FileHistoryRecord[]): void {
  db.prepare(`DELETE FROM file_history_entries WHERE session_id = ?`).run(sessionId);
  const insert = db.prepare(
    `INSERT INTO file_history_entries (session_id, file_path, backup_file_name, version, backup_time)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const r of records) {
    insert.run(sessionId, r.filePath, r.backupFileName, r.version, r.backupTime);
  }
}

export function upsertMemoryFile(
  db: IndexDb,
  record: MemoryFileRecord,
  mtimeMs: number,
  indexedAt: number
): void {
  db.prepare(
    `INSERT INTO memory_files (file_path, project_id, mtime_ms, name, description, type, last_indexed_at)
     VALUES (@filePath, @projectId, @mtimeMs, @name, @description, @type, @indexedAt)
     ON CONFLICT(file_path) DO UPDATE SET
       project_id = excluded.project_id,
       mtime_ms = excluded.mtime_ms,
       name = excluded.name,
       description = excluded.description,
       type = excluded.type,
       last_indexed_at = excluded.last_indexed_at`
  ).run({
    filePath: record.filePath,
    projectId: record.projectId,
    mtimeMs,
    name: record.name,
    description: record.description,
    type: record.type,
    indexedAt
  });
}

// (v1.11, CR-CORE-06) Both listProjects/listProjectsByRoot are filtered to kind = 'code' — GET
// /api/projects's documented contract is Code-projects-only (the default {CLAUDE_HOME}/projects
// root plus persisted custom roots); Cowork/Chat pseudo-projects are surfaced only via the new
// GET /api/projects/project-groups endpoint (listProjectsByKind below), never leaking into this
// existing, unversioned-shape endpoint.

export function listProjects(db: IndexDb): ProjectEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id,
              COALESCE(p.path, p.dir_path) AS path,
              COUNT(s.id) AS sessionCount,
              MAX(s.ended_at) AS lastActiveAt
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       WHERE p.kind = 'code'
       GROUP BY p.id
       ORDER BY p.id`
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    sessionCount: r.sessionCount,
    lastActiveAt: r.lastActiveAt ?? null
  }));
}

export function listProjectsByRoot(db: IndexDb, root: string): ProjectEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id,
              COALESCE(p.path, p.dir_path) AS path,
              COUNT(s.id) AS sessionCount,
              MAX(s.ended_at) AS lastActiveAt
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       WHERE p.root = ? AND p.kind = 'code'
       GROUP BY p.id
       ORDER BY p.id`
    )
    .all(root) as any[];

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    sessionCount: r.sessionCount,
    lastActiveAt: r.lastActiveAt ?? null
  }));
}

/**
 * (v1.11, CR-CORE-06) Every pseudo-project of the given kind ('cowork' | 'chat'), each with its
 * session count — the data source for `GET /api/projects/project-groups`'s cowork/chat buckets. `id`
 * is the full pseudo-project id (e.g. `"cowork:<spaceId>"`), directly usable as `:id` against every
 * existing per-project route (`.../sessions`, `.../detail`, `.../content`) — Cowork/Chat sessions
 * reuse that whole surface unmodified.
 */
export function listProjectsByKind(db: IndexDb, kind: "cowork" | "chat"): ProjectGroupEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id,
              p.path AS name,
              COUNT(s.id) AS sessionCount
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       WHERE p.kind = ?
       GROUP BY p.id
       ORDER BY p.path`
    )
    .all(kind) as any[];

  return rows.map((r) => ({ id: r.id, name: r.name ?? r.id, sessionCount: r.sessionCount }));
}

export function projectExists(db: IndexDb, id: string): boolean {
  const row = db.prepare(`SELECT 1 FROM projects WHERE id = ?`).get(id);
  return !!row;
}

export function getProjectPath(db: IndexDb, id: string): string | null {
  const row = db.prepare(`SELECT COALESCE(path, dir_path) AS path FROM projects WHERE id = ?`).get(id) as
    | { path: string }
    | undefined;
  return row ? row.path : null;
}

export function listSessions(db: IndexDb, projectId: string): SessionEntry[] {
  const rows = db
    .prepare(
      `SELECT s.id AS id, s.started_at AS startedAt, s.ended_at AS endedAt,
              s.message_count AS messageCount, s.git_branch AS gitBranch, s.preview,
              s.subagent_count AS subagentCount, s.touched_memory AS touchedMemory,
              s.file_count AS fileCount,
              COALESCE(mt.cnt, 0) AS memoryTouchCount,
              COALESCE(tr.cnt, 0) AS toolResultCount
       FROM sessions s
       LEFT JOIN (
         SELECT session_id, COUNT(*) AS cnt FROM session_memory_touches GROUP BY session_id
       ) mt ON mt.session_id = s.id
       LEFT JOIN (
         SELECT session_id, COUNT(*) AS cnt FROM tool_result_overflows GROUP BY session_id
       ) tr ON tr.session_id = s.id
       WHERE s.project_id = ?
       ORDER BY s.started_at`
    )
    .all(projectId) as any[];

  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    messageCount: r.messageCount,
    gitBranch: r.gitBranch,
    preview: r.preview,
    subagentCount: r.subagentCount,
    touchedMemory: !!r.touchedMemory,
    memoryTouchCount: r.memoryTouchCount,
    toolResultCount: r.toolResultCount,
    fileCount: r.fileCount,
    // Computed by the caller (routes/projects.ts), which also needs annotations.db's notes table —
    // the two SQLite files are never merged/joined at the SQL level (D16). Defaulted here so this
    // function alone still returns a fully-shaped SessionEntry[].
    hasNotedDescendant: false
  }));
}

/** The on-disk `.jsonl` path for a session, for GET .../content (CR-UI-08). */
export function getSessionFilePath(db: IndexDb, sessionId: string): string | null {
  const row = db.prepare(`SELECT file_path FROM sessions WHERE id = ?`).get(sessionId) as
    | { file_path: string }
    | undefined;
  return row ? row.file_path : null;
}

/**
 * Whether `filePath` is a known, indexed memory file for `projectId` — the security check GET
 * .../memory-content relies on before ever touching the filesystem with a query-param path
 * (CR-UI-08: never read an arbitrary path from a query parameter).
 */
export function memoryFileExists(db: IndexDb, projectId: string, filePath: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM memory_files WHERE project_id = ? AND file_path = ?`)
    .get(projectId, filePath);
  return !!row;
}

/**
 * Whether `filePath` is a known subagent file (transcript or meta.json, per `SubagentRecord.filePath`)
 * for `projectId` — the security check GET .../agent-content relies on before ever touching the
 * filesystem with a query-param path (CR-UI-15, mirrors `memoryFileExists`'s pattern).
 */
export function subagentFileExists(db: IndexDb, projectId: string, filePath: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM subagents sub
       JOIN sessions s ON s.id = sub.session_id
       WHERE s.project_id = ? AND sub.file_path = ?`
    )
    .get(projectId, filePath);
  return !!row;
}

/**
 * Whether `filePath` is a known tool-result overflow file for `projectId` — the security check
 * GET .../tool-content relies on before ever touching the filesystem with a query-param path
 * (CR-UI-15, mirrors `memoryFileExists`'s pattern).
 */
export function toolResultFileExists(db: IndexDb, projectId: string, filePath: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM tool_result_overflows tro
       JOIN sessions s ON s.id = tro.session_id
       WHERE s.project_id = ? AND tro.file_path = ?`
    )
    .get(projectId, filePath);
  return !!row;
}

/**
 * (v1.10, CR-CORE-05) Whether `backupFileName` is a known, indexed file-history backup for
 * `sessionId` — the security check GET .../file-content relies on before ever touching the
 * filesystem with a query-param path (mirrors `memoryFileExists`'s pattern). The route derives
 * `sessionId`/`backupFileName` from the requested path's position under `defaultFileHistoryRoot()`
 * and additionally confirms `sessionId` belongs to the requested project via `sessionExists`.
 */
export function fileHistoryBackupExists(db: IndexDb, sessionId: string, backupFileName: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM file_history_entries WHERE session_id = ? AND backup_file_name = ?`)
    .get(sessionId, backupFileName);
  return !!row;
}

export interface SessionDescendantNodeRef {
  sessionId: string;
  nodeType: "subagent" | "memoryTouch" | "tool";
  nodeId: string;
}

/**
 * Every (sessionId, nodeType, nodeId) sub-item reference for a project's sessions — subagents,
 * memory touches, and tool-result overflows, each already `session_id`-keyed in index.db.
 * (CR-UI-28) The caller (routes/projects.ts) cross-references this against annotations.db's
 * `notes` table in application code (never a SQL-level join across the two DB files, D16) to
 * compute `hasNotedDescendant` for GET /api/projects/:id/sessions.
 */
export function listSessionDescendantNodeRefs(db: IndexDb, projectId: string): SessionDescendantNodeRef[] {
  const rows = db
    .prepare(
      `SELECT s.id AS sessionId, 'subagent' AS nodeType, sub.agent_id AS nodeId
       FROM subagents sub
       JOIN sessions s ON s.id = sub.session_id
       WHERE s.project_id = @projectId
       UNION ALL
       SELECT s.id AS sessionId, 'memoryTouch' AS nodeType, smt.file_path AS nodeId
       FROM session_memory_touches smt
       JOIN sessions s ON s.id = smt.session_id
       WHERE s.project_id = @projectId
       UNION ALL
       SELECT s.id AS sessionId, 'tool' AS nodeType, tro.tool_use_id AS nodeId
       FROM tool_result_overflows tro
       JOIN sessions s ON s.id = tro.session_id
       WHERE s.project_id = @projectId AND tro.tool_use_id IS NOT NULL`
    )
    .all({ projectId }) as SessionDescendantNodeRef[];
  return rows;
}

export function sessionExists(db: IndexDb, projectId: string, sessionId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sessions WHERE project_id = ? AND id = ?`)
    .get(projectId, sessionId);
  return !!row;
}

export function getSessionDetail(db: IndexDb, sessionId: string): SessionDetail {
  const subagents = db
    .prepare(
      `SELECT agent_id AS agentId, agent_type AS agentType, description, file_path AS filePath
       FROM subagents
       WHERE session_id = ?
       ORDER BY agent_id`
    )
    .all(sessionId) as {
    agentId: string;
    agentType: string | null;
    description: string | null;
    filePath: string | null;
  }[];

  const memoryTouches = db
    .prepare(
      `SELECT smt.file_path AS filePath, mf.name AS name
       FROM session_memory_touches smt
       LEFT JOIN memory_files mf ON mf.file_path = smt.file_path
       WHERE smt.session_id = ?
       ORDER BY smt.file_path`
    )
    .all(sessionId) as { filePath: string; name: string | null }[];

  const overflows = db
    .prepare(
      `SELECT tool_use_id AS toolUseId, file_path AS filePath
       FROM tool_result_overflows
       WHERE session_id = ?
       ORDER BY file_path`
    )
    .all(sessionId) as { toolUseId: string | null; filePath: string }[];

  const files = db
    .prepare(
      `SELECT file_path AS filePath, backup_file_name AS backupFileName, version, backup_time AS backupTime
       FROM file_history_entries
       WHERE session_id = ?
       ORDER BY file_path`
    )
    .all(sessionId) as { filePath: string; backupFileName: string; version: number; backupTime: string | null }[];

  return { subagents, memoryTouches, overflows, files };
}
