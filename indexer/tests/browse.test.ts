import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

const NONEXISTENT_DEFAULT_ROOT = path.join(os.tmpdir(), "indexer-no-such-default-root");

describe("Custom scan root — POST /api/projects/browse (CR-CORE-02)", () => {
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
      defaultProjectsRoot: NONEXISTENT_DEFAULT_ROOT,
      desktopSessionsRoot: fixture.desktopSessionsRoot,
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  it("a valid CLAUDE_HOME-like path (with a projects/ subfolder) returns the correct project entries", async () => {
    const res = await request(app).post("/api/projects/browse").send({ path: fixture.tmpRoot });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: fixture.projectDirName, sessionCount: 3 });
  });

  it("a valid path that IS itself the projects root also resolves", async () => {
    const res = await request(app).post("/api/projects/browse").send({ path: fixture.projectsRoot });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(fixture.projectDirName);
  });

  it("a non-existent path returns a clean 400 with an error message", async () => {
    const res = await request(app)
      .post("/api/projects/browse")
      .send({ path: path.join(os.tmpdir(), "definitely-does-not-exist-" + Date.now()) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("a path with no valid session data returns a clean 400", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-empty-"));
    try {
      const res = await request(app).post("/api/projects/browse").send({ path: emptyDir });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("a missing/invalid body.path returns a clean 400, not a crash", async () => {
    const res = await request(app).post("/api/projects/browse").send({});
    expect(res.status).toBe(400);
  });
});

describe("Custom scan root persistence across a restart (CR-CORE-02 AC3)", () => {
  let fixture: Fixture;
  let dbDir: string;

  beforeEach(() => {
    fixture = buildFixture();
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-dbdir-"));
  });

  afterEach(() => {
    cleanupFixture(fixture);
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it("a browsed root persisted in annotations.db survives a simulated restart", async () => {
    const indexDbPath = path.join(dbDir, "index.db");
    const annotationsDbPath = path.join(dbDir, "annotations.db");

    // --- "session 1": browse the custom root, then shut everything down -----------------------
    let indexDb = openIndexDb(indexDbPath);
    let annotationsDb = openAnnotationsDb(annotationsDbPath);
    let app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: NONEXISTENT_DEFAULT_ROOT,
      desktopSessionsRoot: fixture.desktopSessionsRoot,
      logger: { warn: () => {}, info: () => {} }
    });

    const browseRes = await request(app).post("/api/projects/browse").send({ path: fixture.tmpRoot });
    expect(browseRes.status).toBe(200);

    indexDb.close();
    annotationsDb.close();

    // --- "session 2": re-instantiate the app/DB layer from the same files (simulated restart) -
    indexDb = openIndexDb(indexDbPath);
    annotationsDb = openAnnotationsDb(annotationsDbPath);
    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: NONEXISTENT_DEFAULT_ROOT,
      desktopSessionsRoot: fixture.desktopSessionsRoot,
      logger: { warn: () => {}, info: () => {} }
    });

    const listRes = await request(app).get("/api/projects");
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((p: any) => p.id === fixture.projectDirName)).toBe(true);

    indexDb.close();
    annotationsDb.close();
  });
});
