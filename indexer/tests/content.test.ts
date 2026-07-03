import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-UI-08 — session content + memory content read endpoints.

describe("GET /api/projects/:id/sessions/:sessionId/content (CR-UI-08)", () => {
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

  it("extracts only user/assistant text turns for a plain session (session-aaa)", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/session-aaa/content`
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      messages: [
        {
          role: "user",
          text: "Hello, let's start working on the widget feature.",
          timestamp: "2026-06-01T10:00:00.000Z"
        },
        { role: "assistant", text: "Sure, let's do it.", timestamp: "2026-06-01T10:01:00.000Z" }
      ]
    });
  });

  it("skips tool_use and tool_result content blocks, keeping only the real text turn (session-bbb)", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/session-bbb/content`
    );
    expect(res.status).toBe(200);
    // session-bbb's later turns are all tool_use (Task/Write/Bash) or a tool_result — none carry
    // extractable text, so only the opening user message should be returned.
    expect(res.body.messages).toEqual([
      {
        role: "user",
        text: "Let's refactor the auth module.",
        timestamp: "2026-06-02T09:00:00.000Z"
      }
    ]);
  });

  it("tolerates a malformed line and still extracts the valid text turns (session-ccc)", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/session-ccc/content`
    );
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      {
        role: "user",
        text: "Quick question about the build script.",
        timestamp: "2026-06-03T08:00:00.000Z"
      },
      {
        role: "assistant",
        text: "It runs `npm run build`.",
        timestamp: "2026-06-03T08:01:00.000Z"
      }
    ]);
  });

  it("an unknown project returns a clean 404", async () => {
    const res = await request(app).get("/api/projects/does-not-exist/sessions/session-aaa/content");
    expect(res.status).toBe(404);
  });

  it("an unknown session returns a clean 404", async () => {
    const res = await request(app).get(
      `/api/projects/${fixture.projectDirName}/sessions/does-not-exist/content`
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id/memory-content (CR-UI-08)", () => {
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

  it("returns the raw text of a known, indexed memory file", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/memory-content`)
      .query({ path: fixture.memoryTopic1Path });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("Auth refactor notes body.");
    expect(res.body.content).toContain("name: Auth Notes");
  });

  it("SECURITY: returns a clean 400 for a path that is not an indexed memory file, without reading it (arbitrary path traversal attempt)", async () => {
    const arbitraryPath = path.join(fixture.tmpRoot, "..", "some-other-secret-file.txt");
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/memory-content`)
      .query({ path: arbitraryPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.content).toBeUndefined();
  });

  it("SECURITY: returns a clean 400 for a real file on disk that simply isn't an indexed memory file (e.g. a session file)", async () => {
    const res = await request(app)
      .get(`/api/projects/${fixture.projectDirName}/memory-content`)
      .query({ path: fixture.sessionAaaPath });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("a missing path query param returns a clean 400", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/memory-content`);
    expect(res.status).toBe(400);
  });

  it("an unknown project returns a clean 404", async () => {
    const res = await request(app)
      .get("/api/projects/does-not-exist/memory-content")
      .query({ path: fixture.memoryTopic1Path });
    expect(res.status).toBe(404);
  });
});
