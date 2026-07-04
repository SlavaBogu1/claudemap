import Database from "better-sqlite3";
import type {
  MemoryFileRecord,
  ProjectEntry,
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
      path TEXT
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
  `);
  return db;
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
 * **Never touches `annotations.db`** (D16): a user note or claude-map note on this session's id
 * survives untouched so it isn't lost if the file is later restored/renamed.
 */
export function deleteSession(db: IndexDb, sessionId: string): void {
  const del = db.transaction((id: string) => {
    db.prepare(`DELETE FROM subagents WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM tool_result_overflows WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM session_memory_touches WHERE session_id = ?`).run(id);
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
  indexedAt: number;
}

export function upsertSession(db: IndexDb, s: UpsertSessionInput): void {
  db.prepare(
    `INSERT INTO sessions
       (id, project_id, file_path, mtime_ms, started_at, ended_at, message_count, git_branch,
        slug, preview, touched_memory, subagent_count, last_indexed_at)
     VALUES (@id, @projectId, @filePath, @mtimeMs, @startedAt, @endedAt, @messageCount, @gitBranch,
             @slug, @preview, @touchedMemory, @subagentCount, @indexedAt)
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

export function listProjects(db: IndexDb): ProjectEntry[] {
  const rows = db
    .prepare(
      `SELECT p.id AS id,
              COALESCE(p.path, p.dir_path) AS path,
              COUNT(s.id) AS sessionCount,
              MAX(s.ended_at) AS lastActiveAt
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
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
       WHERE p.root = ?
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

  return { subagents, memoryTouches, overflows };
}
