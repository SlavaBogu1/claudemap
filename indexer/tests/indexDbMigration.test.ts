import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openIndexDb, upsertSession, listSessions, listProjects, type IndexDb } from "../src/db/indexDb.js";

// CR-CORE-07 — a real, pre-existing on-disk index.db built by an older schema version (before
// CR-CORE-05 added sessions.file_count and CR-CORE-06 added projects.kind) must keep working, not
// crash with an unhandled SqliteError on the very first write/read against a newly-added column.
// The existing suite always opened a fresh :memory: DB (schema created fresh every time, so
// `CREATE TABLE IF NOT EXISTS` trivially "succeeded" without ever exercising a real migration) — this
// is the specific on-disk-DB gap that let the regression ship undetected.

describe("openIndexDb migrates a pre-existing old-shaped on-disk DB (CR-CORE-07)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-migration-"));
    dbPath = path.join(tmpDir, "index.db");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Builds a real on-disk index.db shaped like the pre-Sprint-8 schema (no `kind`/`file_count`). */
  function buildOldShapedDb(): void {
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        dir_path TEXT NOT NULL,
        path TEXT
      );

      CREATE TABLE sessions (
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
    `);

    // Real pre-existing data that must survive the migration untouched.
    raw
      .prepare(`INSERT INTO projects (id, root, dir_path, path) VALUES (?, ?, ?, ?)`)
      .run("D--Real--Project", "D:\\Real", "D--Real--Project", "D:\\Real\\Project");
    raw
      .prepare(
        `INSERT INTO sessions
           (id, project_id, file_path, mtime_ms, started_at, ended_at, message_count, git_branch,
            slug, preview, touched_memory, subagent_count, last_indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "session-real-1",
        "D--Real--Project",
        "D:\\Real\\Project\\session-real-1.jsonl",
        1000,
        "2026-06-01T00:00:00.000Z",
        "2026-06-01T00:05:00.000Z",
        4,
        "main",
        null,
        "A real pre-existing session.",
        0,
        0,
        1000
      );

    raw.close();
  }

  it("opens without throwing and adds the missing additive columns", () => {
    buildOldShapedDb();

    let db: IndexDb | undefined;
    expect(() => {
      db = openIndexDb(dbPath);
    }).not.toThrow();

    const projectColumns = (db!.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[]).map(
      (c) => c.name
    );
    const sessionColumns = (db!.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(projectColumns).toContain("kind");
    expect(sessionColumns).toContain("file_count");

    db!.close();
  });

  it("preserves existing project/session rows through the migration, with sensible defaults on the new columns", () => {
    buildOldShapedDb();
    const db = openIndexDb(dbPath);

    const projects = listProjects(db);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: "D--Real--Project", path: "D:\\Real\\Project" });

    const sessions = listSessions(db, "D--Real--Project");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "session-real-1",
      messageCount: 4,
      preview: "A real pre-existing session.",
      fileCount: 0 // new column, defaulted for pre-existing rows — not lost/nulled data
    });

    const kindRow = db.prepare(`SELECT kind FROM projects WHERE id = ?`).get("D--Real--Project") as {
      kind: string;
    };
    expect(kindRow.kind).toBe("code"); // default applied to the pre-existing row, per CR-CORE-06

    db.close();
  });

  it("no longer crashes on the write that used to throw 'table sessions has no column named file_count'", () => {
    buildOldShapedDb();
    const db = openIndexDb(dbPath);

    // This is exactly the write rescanProjectSessions makes on every rescan (D13) — reproduced by
    // the Tester as the crash site (indexDb.ts upsertSession, called from rescan.ts).
    expect(() => {
      upsertSession(db, {
        id: "session-real-1",
        projectId: "D--Real--Project",
        filePath: "D:\\Real\\Project\\session-real-1.jsonl",
        mtimeMs: 2000,
        startedAt: "2026-06-01T00:00:00.000Z",
        endedAt: "2026-06-01T00:06:00.000Z",
        messageCount: 5,
        gitBranch: "main",
        slug: null,
        preview: "A real pre-existing session.",
        touchedMemory: false,
        subagentCount: 0,
        fileCount: 3,
        indexedAt: 2000
      });
    }).not.toThrow();

    const sessions = listSessions(db, "D--Real--Project");
    expect(sessions[0]).toMatchObject({ messageCount: 5, fileCount: 3 });

    db.close();
  });

  it("is idempotent — reopening an already-migrated on-disk DB a second time is a no-op, not a re-migration error", () => {
    buildOldShapedDb();
    openIndexDb(dbPath).close();

    let db: IndexDb | undefined;
    expect(() => {
      db = openIndexDb(dbPath);
    }).not.toThrow();

    const sessions = listSessions(db!, "D--Real--Project");
    expect(sessions).toHaveLength(1);
    db!.close();
  });

  it("a brand-new on-disk DB (no pre-existing file) still has every column from a fresh CREATE TABLE, unaffected by the migration step", () => {
    const db = openIndexDb(dbPath);
    const projectColumns = (db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[]).map(
      (c) => c.name
    );
    const sessionColumns = (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(projectColumns).toContain("kind");
    expect(sessionColumns).toContain("file_count");
    db.close();
  });
});
