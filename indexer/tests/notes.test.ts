import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, listNotes, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { rescan } from "../src/discovery/rescan.js";
import { createApp } from "../src/api/app.js";

const NODE_TYPES = ["session", "memoryTouch", "subagent", "tool", "project"] as const;

describe("Notes CRUD (CR-UI-08)", () => {
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
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  it("create-then-fetch round-trip via GET /:id/notes", async () => {
    const putRes = await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({ content: "Watch this session for the widget decision." });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({
      projectId: fixture.projectDirName,
      nodeType: "session",
      nodeId: "session-aaa",
      content: "Watch this session for the widget decision.",
      format: "markdown"
    });
    expect(putRes.body.createdAt).toBeTruthy();
    expect(putRes.body.updatedAt).toBe(putRes.body.createdAt);

    const getRes = await request(app).get(`/api/projects/${fixture.projectDirName}/notes`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveLength(1);
    expect(getRes.body[0]).toMatchObject({ nodeType: "session", nodeId: "session-aaa" });
  });

  it("a repeated PUT upserts — no duplicate row; created_at stable, updated_at changes", async () => {
    const first = await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({ content: "First version." });
    expect(first.status).toBe(200);

    // Ensure a strictly later timestamp even on a fast filesystem clock.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({ content: "Second version." });
    expect(second.status).toBe(200);
    expect(second.body.content).toBe("Second version.");
    expect(second.body.createdAt).toBe(first.body.createdAt);
    expect(second.body.updatedAt).not.toBe(first.body.updatedAt);

    const listRes = await request(app).get(`/api/projects/${fixture.projectDirName}/notes`);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].content).toBe("Second version.");
  });

  it("DELETE removes the row; a second delete returns a clean 404", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({ content: "Temporary note." });

    const del1 = await request(app).delete(
      `/api/projects/${fixture.projectDirName}/notes/session/session-aaa`
    );
    expect(del1.status).toBe(204);

    const listRes = await request(app).get(`/api/projects/${fixture.projectDirName}/notes`);
    expect(listRes.body).toHaveLength(0);

    const del2 = await request(app).delete(
      `/api/projects/${fixture.projectDirName}/notes/session/session-aaa`
    );
    expect(del2.status).toBe(404);
    expect(del2.body).toHaveProperty("error");
  });

  it("a note attaches correctly for each of the 5 node_type values used in this codebase", async () => {
    for (const nodeType of NODE_TYPES) {
      const res = await request(app)
        .put(`/api/projects/${fixture.projectDirName}/notes/${nodeType}/node-${nodeType}-1`)
        .send({ content: `Note for ${nodeType}` });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nodeType, nodeId: `node-${nodeType}-1` });
    }

    const listRes = await request(app).get(`/api/projects/${fixture.projectDirName}/notes`);
    expect(listRes.body).toHaveLength(NODE_TYPES.length);
    for (const nodeType of NODE_TYPES) {
      expect(listRes.body.some((n: any) => n.nodeType === nodeType && n.nodeId === `node-${nodeType}-1`)).toBe(
        true
      );
    }
  });

  it("PUT with a missing/empty content returns a clean 400", async () => {
    const res = await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("notes endpoints for an unknown project return a clean 404", async () => {
    const getRes = await request(app).get("/api/projects/does-not-exist/notes");
    expect(getRes.status).toBe(404);

    const putRes = await request(app)
      .put("/api/projects/does-not-exist/notes/session/session-aaa")
      .send({ content: "x" });
    expect(putRes.status).toBe(404);

    const delRes = await request(app).delete("/api/projects/does-not-exist/notes/session/session-aaa");
    expect(delRes.status).toBe(404);
  });
});

describe("notes table survives an index.db rescan/rebuild untouched (D16)", () => {
  let fixture: Fixture;
  let dbDir: string;

  beforeEach(() => {
    fixture = buildFixture();
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-notes-dbdir-"));
  });

  afterEach(() => {
    cleanupFixture(fixture);
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it("a note persisted in annotations.db is unaffected by deleting and rebuilding index.db", async () => {
    const indexDbPath = path.join(dbDir, "index.db");
    const annotationsDbPath = path.join(dbDir, "annotations.db");

    let indexDb = openIndexDb(indexDbPath);
    let annotationsDb = openAnnotationsDb(annotationsDbPath);
    rescan({ db: indexDb, projectsRoots: [fixture.projectsRoot], logger: { warn: () => {}, info: () => {} } });

    let app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });

    const putRes = await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-bbb`)
      .send({ content: "Important note that must survive a rebuild." });
    expect(putRes.status).toBe(200);

    indexDb.close();
    annotationsDb.close();

    // --- simulate a full index.db rebuild: delete the rebuildable cache file wholesale (D16) ---
    fs.rmSync(indexDbPath);
    fs.rmSync(`${indexDbPath}-wal`, { force: true });
    fs.rmSync(`${indexDbPath}-shm`, { force: true });

    indexDb = openIndexDb(indexDbPath); // recreated from scratch, empty schema
    rescan({ db: indexDb, projectsRoots: [fixture.projectsRoot], logger: { warn: () => {}, info: () => {} } });
    annotationsDb = openAnnotationsDb(annotationsDbPath); // never deleted — durable store (D16)

    // The note must still be there, completely untouched by the index.db wipe/rebuild.
    const notes = listNotes(annotationsDb, fixture.projectDirName);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      nodeType: "session",
      nodeId: "session-bbb",
      content: "Important note that must survive a rebuild."
    });

    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });
    const getRes = await request(app).get(`/api/projects/${fixture.projectDirName}/notes`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveLength(1);

    indexDb.close();
    annotationsDb.close();
  });
});
