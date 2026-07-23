import Database from "better-sqlite3";
import type { StickItNoteRecord, NoteRecord } from "../types.js";

export type AnnotationsDb = Database.Database;

/**
 * Open (or create) the durable annotations.db store. This file holds user-authored data only
 * (custom scan roots, D20; notes, CR-UI-08; stick-it notes, CR-CORE-03 — ingest-written, not
 * user-authored, but still durable and never rebuildable; bookmarks/links planned per D14) — a
 * rescan/rebuild of index.db must never read from or write to this file (D16).
 */
export function openAnnotationsDb(filePath: string): AnnotationsDb {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_roots (
      path TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      project_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      node_id TEXT NOT NULL,
      content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'markdown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, node_type, node_id)
    );

    CREATE TABLE IF NOT EXISTS stick_it_notes (
      project_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      node_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, node_type, node_id)
    );
  `);
  return db;
}

export function addScanRoot(db: AnnotationsDb, browsedPath: string): void {
  db.prepare(
    `INSERT INTO scan_roots (path, added_at) VALUES (?, ?)
     ON CONFLICT(path) DO NOTHING`
  ).run(browsedPath, new Date().toISOString());
}

export function listScanRoots(db: AnnotationsDb): string[] {
  const rows = db.prepare(`SELECT path FROM scan_roots ORDER BY added_at`).all() as { path: string }[];
  return rows.map((r) => r.path);
}

/**
 * (CR-CORE-08) Removes a persisted custom scan root added via `addScanRoot`. A no-op (not an
 * error) if `browsedPath` isn't currently persisted — removing an already-removed/non-existent
 * root must never crash, only a real database error should throw.
 */
export function deleteScanRoot(db: AnnotationsDb, browsedPath: string): void {
  db.prepare(`DELETE FROM scan_roots WHERE path = ?`).run(browsedPath);
}

function toNoteRecord(row: {
  project_id: string;
  node_type: string;
  node_id: string;
  content: string;
  format: string;
  created_at: string;
  updated_at: string;
}): NoteRecord {
  return {
    projectId: row.project_id,
    nodeType: row.node_type,
    nodeId: row.node_id,
    content: row.content,
    format: row.format,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** All notes for a project (CR-UI-08). */
export function listNotes(db: AnnotationsDb, projectId: string): NoteRecord[] {
  const rows = db
    .prepare(
      `SELECT project_id, node_type, node_id, content, format, created_at, updated_at
       FROM notes WHERE project_id = ? ORDER BY node_type, node_id`
    )
    .all(projectId) as any[];
  return rows.map(toNoteRecord);
}

/**
 * Create-or-update a note (CR-UI-08). `created_at` is preserved across updates; `updated_at`
 * always reflects the current write — an upsert, never a duplicate row (enforced by the
 * `(project_id, node_type, node_id)` primary key).
 */
export function upsertNote(
  db: AnnotationsDb,
  projectId: string,
  nodeType: string,
  nodeId: string,
  content: string,
  format: string,
  now: () => string = () => new Date().toISOString()
): NoteRecord {
  const timestamp = now();
  db.prepare(
    `INSERT INTO notes (project_id, node_type, node_id, content, format, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, node_type, node_id) DO UPDATE SET
       content = excluded.content,
       format = excluded.format,
       updated_at = excluded.updated_at`
  ).run(projectId, nodeType, nodeId, content, format, timestamp, timestamp);

  const row = db
    .prepare(
      `SELECT project_id, node_type, node_id, content, format, created_at, updated_at
       FROM notes WHERE project_id = ? AND node_type = ? AND node_id = ?`
    )
    .get(projectId, nodeType, nodeId) as any;
  return toNoteRecord(row);
}

/** Deletes a note; returns whether a row actually existed (drives 204 vs. clean 404). */
export function deleteNote(db: AnnotationsDb, projectId: string, nodeType: string, nodeId: string): boolean {
  const result = db
    .prepare(`DELETE FROM notes WHERE project_id = ? AND node_type = ? AND node_id = ?`)
    .run(projectId, nodeType, nodeId);
  return result.changes > 0;
}

function toStickItNoteRecord(row: {
  project_id: string;
  node_type: string;
  node_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}): StickItNoteRecord {
  return {
    projectId: row.project_id,
    nodeType: row.node_type,
    nodeId: row.node_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * All stick-it notes for a project (CR-CORE-03) — one aggregated, view-only note per session that
 * has at least one `[stick-it] <text>` marker in its transcript.
 */
export function listStickItNotes(db: AnnotationsDb, projectId: string): StickItNoteRecord[] {
  const rows = db
    .prepare(
      `SELECT project_id, node_type, node_id, content, created_at, updated_at
       FROM stick_it_notes WHERE project_id = ? ORDER BY node_type, node_id`
    )
    .all(projectId) as any[];
  return rows.map(toStickItNoteRecord);
}

/**
 * Create-or-replace a stick-it note (CR-CORE-03), ingest-time only — never called from a
 * client-facing endpoint. `created_at` is preserved across updates; `updated_at` always reflects
 * the current write. Unlike `upsertNote`, there is no user-edit path into this table, so a rescan is
 * always free to replace the row's content wholesale (no collision to guard against).
 */
export function upsertStickItNote(
  db: AnnotationsDb,
  projectId: string,
  nodeType: string,
  nodeId: string,
  content: string,
  now: () => string = () => new Date().toISOString()
): StickItNoteRecord {
  const timestamp = now();
  db.prepare(
    `INSERT INTO stick_it_notes (project_id, node_type, node_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, node_type, node_id) DO UPDATE SET
       content = excluded.content,
       updated_at = excluded.updated_at`
  ).run(projectId, nodeType, nodeId, content, timestamp, timestamp);

  const row = db
    .prepare(
      `SELECT project_id, node_type, node_id, content, created_at, updated_at
       FROM stick_it_notes WHERE project_id = ? AND node_type = ? AND node_id = ?`
    )
    .get(projectId, nodeType, nodeId) as any;
  return toStickItNoteRecord(row);
}

/**
 * Deletes a stick-it note, ingest-time only (CR-CORE-03) — used when a rescan finds a session's
 * marker set has become empty (e.g. transcript no longer contains any `[stick-it]` line), so a
 * stale aggregated note is never left behind. Returns whether a row actually existed.
 */
export function deleteStickItNote(
  db: AnnotationsDb,
  projectId: string,
  nodeType: string,
  nodeId: string
): boolean {
  const result = db
    .prepare(`DELETE FROM stick_it_notes WHERE project_id = ? AND node_type = ? AND node_id = ?`)
    .run(projectId, nodeType, nodeId);
  return result.changes > 0;
}
