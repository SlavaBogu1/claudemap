import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-CORE-05 — file-history-snapshot parsing, fileCount, .../detail's files array, and
// GET .../file-content.

describe("fileCount on GET /api/projects/:id/sessions (CR-CORE-05)", () => {
  let fixture: Fixture;
  let indexDb: IndexDb;
  let annotationsDb: AnnotationsDb;
  let app: Express;

  beforeEach(() => {
    fixture = buildFixture();
    indexDb = openIndexDb(":memory:");
    annotationsDb = openAnnotationsDb(":memory:");
    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      fileHistoryRoot: fixture.fileHistoryRoot,
      desktopSessionsRoot: fixture.desktopSessionsRoot,
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  it("counts each unique file path once, even though one path (test_auth.py) was backed up at two versions", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    expect(res.status).toBe(200);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    // test_auth.py (v1 then v2, kept once) + README.md (v1) = 2 unique files, not 3 snapshot rows.
    expect(bbb.fileCount).toBe(2);
  });

  it("reports fileCount: 0 for a session whose only file-history-snapshot line has an empty trackedFileBackups", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const aaa = res.body.find((s: any) => s.id === "session-aaa");
    expect(aaa.fileCount).toBe(0);
  });

  it("reports fileCount: 0 for a session with no file-history-snapshot lines at all", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const ccc = res.body.find((s: any) => s.id === "session-ccc");
    expect(ccc.fileCount).toBe(0);
  });
});

describe("GET .../detail's files array (CR-CORE-05)", () => {
  let fixture: Fixture;
  let indexDb: IndexDb;
  let annotationsDb: AnnotationsDb;
  let app: Express;

  beforeEach(() => {
    fixture = buildFixture();
    indexDb = openIndexDb(":memory:");
    annotationsDb = openAnnotationsDb(":memory:");
    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      fileHistoryRoot: fixture.fileHistoryRoot,
      desktopSessionsRoot: fixture.desktopSessionsRoot,
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  it("keeps the highest version's backupFileName/version/backupTime for a path backed up more than once", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/session-bbb/detail`
    );
    expect(res.status).toBe(200);
    const authPy = res.body.files.find((f: any) => f.filePath === "backend\\tests\\test_auth.py");
    expect(authPy).toEqual({
      filePath: "backend\\tests\\test_auth.py",
      backupFileName: fixture.fileHistoryAuthPyBackupName,
      version: 2,
      backupTime: "2026-06-02T09:05:00.000Z"
    });
  });

  it("a session with no file-history-snapshot data returns an empty files array, not an error", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/session-ccc/detail`
    );
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });
});

describe("GET /api/projects/:id/file-content (CR-CORE-05)", () => {
  let fixture: Fixture;
  let indexDb: IndexDb;
  let annotationsDb: AnnotationsDb;
  let app: Express;

  beforeEach(() => {
    fixture = buildFixture();
    indexDb = openIndexDb(":memory:");
    annotationsDb = openAnnotationsDb(":memory:");
    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      fileHistoryRoot: fixture.fileHistoryRoot,
      desktopSessionsRoot: fixture.desktopSessionsRoot,
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  // (CR-CORE-05 re-validation fix) `path` is the relative `{sessionId}/{backupFileName}` identifier
  // — exactly what visualizer/src/api/client.ts's fetchFileContent sends, and exactly what
  // `.../detail`'s `files[]` entries expose (`backupFileName`) — never a full filesystem path, which
  // the client has no way to construct (see _API_CONTRACT/CONTRACT.md's file-content v1.12 entry).

  it("returns the raw text of a known, indexed file-history backup", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: `session-bbb/${fixture.fileHistoryAuthPyBackupName}` });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("def test_auth():");
  });

  it("returns the second backed-up file's content too (README.md)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: `session-bbb/${fixture.fileHistoryReadmeBackupName}` });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("# Fixture Project");
  });

  it("SECURITY: returns a clean 400 for a backupFileName never indexed for that session (path traversal / guess attempt)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: "session-bbb/not-a-real-backup@v1" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.content).toBeUndefined();
  });

  it("SECURITY: returns a clean 400 for a real indexed backup filename under the wrong session id", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: `session-aaa/${fixture.fileHistoryAuthPyBackupName}` });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("SECURITY: returns a clean 400 for a full absolute filesystem path (no longer the accepted format)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: fixture.fileHistoryAuthPyBackupPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("SECURITY: returns a clean 400 for a two-segment path containing a traversal segment", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: "..\\session-bbb\\" + fixture.fileHistoryAuthPyBackupName });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("SECURITY: returns a clean 400 for an arbitrary filesystem path outside the file-history root entirely", async () => {
    const arbitraryPath = path.join(fixture.tmpRoot, "..", "some-other-secret-file.txt");
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: arbitraryPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("SECURITY: returns a clean 400 for a real file on disk that simply isn't an indexed file-history backup (e.g. a memory file)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: "session-bbb/topic1.md" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  // (CR-CORE-11) Before CR-CORE-11, this endpoint's own doRescan() left a since-deleted backup's row
  // indexed, so the security check passed and the fs.readFileSync failure below produced a 404
  // ("file no longer exists"). Now every rescan (including this route's own, run at the top of every
  // request) prunes exactly that orphaned row first — so by the time the security check runs, the
  // backup is no longer "known, indexed" at all, and the route correctly falls into the same 400
  // "not a known file-history backup" branch as any other unindexed path. The endpoint's own
  // defense-in-depth (the try/catch below) is unchanged and still fires for any race outside a
  // rescan's visibility (e.g. deleted between the security check and the read).
  it("returns a clean 400 (no longer indexed) when the backup file has since been removed from disk — CR-CORE-11 prunes it before the read is attempted", async () => {
    fs.rmSync(fixture.fileHistoryAuthPyBackupPath);
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/file-content`)
      .query({ path: `session-bbb/${fixture.fileHistoryAuthPyBackupName}` });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("a missing path query param returns a clean 400", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/file-content`);
    expect(res.status).toBe(400);
  });

  it("an unknown project returns a clean 404", async () => {
    const res = await request(app)
      .get("/api/projects/does-not-exist/file-content")
      .query({ path: `session-bbb/${fixture.fileHistoryAuthPyBackupName}` });
    expect(res.status).toBe(404);
  });
});
