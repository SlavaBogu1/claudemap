import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import {
  openIndexDb,
  type IndexDb,
  listSessions,
  replaceMemoryTouches,
  replaceOverflows,
  upsertProject,
  upsertSession
} from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-UI-07 — memoryTouchCount + toolResultCount on GET /api/projects/:id/sessions.

describe("GET /api/projects/:id/sessions — memoryTouchCount + toolResultCount (CR-UI-07)", () => {
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

  it("reports 0 of each for a session with no memory touches and no overflows (session-aaa)", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    expect(res.status).toBe(200);
    const aaa = res.body.find((s: any) => s.id === "session-aaa");
    expect(aaa).toMatchObject({ memoryTouchCount: 0, toolResultCount: 0, touchedMemory: false });
  });

  it("reports 1 of each for a session with exactly one memory touch and one overflow (session-bbb)", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    expect(bbb).toMatchObject({ memoryTouchCount: 1, toolResultCount: 1, touchedMemory: true });
  });

  it("existing touchedMemory boolean assertions still pass unchanged (regression)", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const aaa = res.body.find((s: any) => s.id === "session-aaa");
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    const ccc = res.body.find((s: any) => s.id === "session-ccc");
    expect(aaa.touchedMemory).toBe(false);
    expect(bbb.touchedMemory).toBe(true);
    expect(ccc.touchedMemory).toBe(false);
  });
});

describe("listSessions — memoryTouchCount + toolResultCount with multiple rows (CR-UI-07)", () => {
  let db: IndexDb;

  beforeEach(() => {
    db = openIndexDb(":memory:");
    upsertProject(db, "proj1", "/root", "/root/proj1");
    upsertSession(db, {
      id: "session-multi",
      projectId: "proj1",
      filePath: "/root/proj1/session-multi.jsonl",
      mtimeMs: 1,
      startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: "2026-06-01T00:05:00.000Z",
      messageCount: 4,
      gitBranch: "main",
      slug: null,
      preview: "multi",
      touchedMemory: true,
      subagentCount: 0,
      indexedAt: 1
    });
  });

  afterEach(() => {
    db.close();
  });

  it("counts multiple memory touches and multiple overflows correctly", () => {
    replaceMemoryTouches(db, "session-multi", [
      "/root/proj1/memory/topic1.md",
      "/root/proj1/memory/topic2.md",
      "/root/proj1/memory/topic3.md"
    ]);
    replaceOverflows(db, "session-multi", [
      { sessionId: "session-multi", toolUseId: "toolu_1", filePath: "/root/.../overflow1.txt" },
      { sessionId: "session-multi", toolUseId: "toolu_2", filePath: "/root/.../overflow2.txt" }
    ]);

    const sessions = listSessions(db, "proj1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].memoryTouchCount).toBe(3);
    expect(sessions[0].toolResultCount).toBe(2);
  });
});
