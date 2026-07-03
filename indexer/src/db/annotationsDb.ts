import Database from "better-sqlite3";

export type AnnotationsDb = Database.Database;

/**
 * Open (or create) the durable annotations.db store. This file holds user-authored data only
 * (custom scan roots today; bookmarks/links in a later sprint per D14) — a rescan/rebuild of
 * index.db must never read from or write to this file (D16).
 */
export function openAnnotationsDb(filePath: string): AnnotationsDb {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_roots (
      path TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
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
