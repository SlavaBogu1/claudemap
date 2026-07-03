import Database from "better-sqlite3";
import type { MemoryFileRecord, ProjectEntry, SessionEntry, SubagentRecord, ToolResultOverflowRecord } from "../types.js";

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
    `INSERT INTO subagents (session_id, agent_id, agent_type, description, tool_use_id)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const r of records) {
    insert.run(sessionId, r.agentId, r.agentType, r.description, r.toolUseId);
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
      `SELECT id, started_at AS startedAt, ended_at AS endedAt, message_count AS messageCount,
              git_branch AS gitBranch, preview, subagent_count AS subagentCount,
              touched_memory AS touchedMemory
       FROM sessions
       WHERE project_id = ?
       ORDER BY started_at`
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
    touchedMemory: !!r.touchedMemory
  }));
}
