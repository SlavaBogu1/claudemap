import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-UI-15 — Agent Path field + GET .../agent-content + GET .../tool-content.

describe("Agent Path field on GET .../detail (CR-UI-15)", () => {
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

  it("returns the subagent's real transcript file path (not a placeholder), preferring the transcript over the meta.json", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/session-bbb/detail`
    );
    expect(res.status).toBe(200);
    expect(res.body.subagents).toEqual([
      {
        agentId: "sub1",
        agentType: "general-purpose",
        description: "Refactor helper",
        filePath: fixture.subagentSub1TranscriptPath
      }
    ]);
  });
});

describe("GET /api/projects/:id/agent-content (CR-UI-15)", () => {
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

  it("renders the subagent's real transcript text (same shape as session content)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/agent-content`)
      .query({ path: fixture.subagentSub1TranscriptPath });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      messages: [
        {
          role: "user",
          text: "You are a helper agent. Refactor the auth module.",
          timestamp: "2026-06-02T09:01:30.000Z"
        },
        {
          role: "assistant",
          text: "Done — auth module refactored.",
          timestamp: "2026-06-02T09:01:45.000Z"
        }
      ]
    });
  });

  it("falls back to the meta.json's description field when no separate transcript file exists on disk (real data always has both per IX-5.1, but the fallback must still work if it doesn't)", async () => {
    // Add a second subagent to the same real subagents directory with ONLY a .meta.json (no
    // matching .jsonl) — rescan.ts's own discovery logic (not a manual DB seed, which the route's
    // own rescan-on-every-GET would just overwrite) will correctly record its file_path as the
    // meta.json itself, since no transcript exists for it to prefer.
    const subagentsDir = path.dirname(fixture.subagentSub1MetaPath);
    const noTranscriptMetaPath = path.join(subagentsDir, "agent-sub2.meta.json");
    fs.writeFileSync(
      noTranscriptMetaPath,
      JSON.stringify({
        agentType: "general-purpose",
        description: "Transcript-less helper",
        toolUseId: "toolu_task2",
        agentId: "sub2"
      })
    );

    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/agent-content`)
      .query({ path: noTranscriptMetaPath });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      messages: [{ role: "assistant", text: "Transcript-less helper", timestamp: null }]
    });
  });

  it("SECURITY: returns a clean 400 for a path that is not a known subagent file (path traversal attempt)", async () => {
    const arbitraryPath = path.join(fixture.tmpRoot, "..", "some-other-secret-file.txt");
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/agent-content`)
      .query({ path: arbitraryPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.messages).toBeUndefined();
  });

  it("SECURITY: returns a clean 400 for a real file on disk that simply isn't an indexed subagent file (e.g. a session file)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/agent-content`)
      .query({ path: fixture.sessionAaaPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("a missing path query param returns a clean 400", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/agent-content`);
    expect(res.status).toBe(400);
  });

  it("an unknown project returns a clean 404", async () => {
    const res = await request(app)
      .get("/api/projects/does-not-exist/agent-content")
      .query({ path: fixture.subagentSub1TranscriptPath });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id/tool-content (CR-UI-15)", () => {
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

  it("returns the raw text of a known, indexed tool-result overflow file", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/tool-content`)
      .query({ path: fixture.overflowFilePath });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("Full overflow content that was too large to inline.");
  });

  it("SECURITY: returns a clean 400 for a path that is not a known tool result file (path traversal attempt)", async () => {
    const arbitraryPath = path.join(fixture.tmpRoot, "..", "some-other-secret-file.txt");
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/tool-content`)
      .query({ path: arbitraryPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.content).toBeUndefined();
  });

  it("SECURITY: returns a clean 400 for a real file on disk that simply isn't an indexed tool result file (e.g. a memory file)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/tool-content`)
      .query({ path: fixture.memoryTopic1Path });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("a missing path query param returns a clean 400", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/tool-content`);
    expect(res.status).toBe(400);
  });

  it("an unknown project returns a clean 404", async () => {
    const res = await request(app)
      .get("/api/projects/does-not-exist/tool-content")
      .query({ path: fixture.overflowFilePath });
    expect(res.status).toBe(404);
  });
});
