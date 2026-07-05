import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-UI-25 — GET /api/projects/:id/content: README -> CLAUDE.md -> first-message -> none.
//
// A self-contained fixture (not the shared helpers/fixture.ts one) is used here because this
// endpoint is the first to actually read files from a project's *resolved real* folder
// (getProjectPath's `cwd`-derived path, per CR-UI-25's spec) rather than the sanitized
// {CLAUDE_HOME}/projects/{id} storage directory — the shared fixture's `realProjectPath` is a
// fake literal ("D:\\Fixture\\ProjectOne") that doesn't exist on disk, which is fine for tests
// that only assert the *value* of that path but not for a test that must place a real README.md/
// CLAUDE.md file there. This fixture instead points `cwd` at a real, controlled temp directory.

interface ContentFixture {
  tmpRoot: string;
  projectsRoot: string;
  projectDirName: string;
  realProjectPath: string;
}

function buildContentFixture(): ContentFixture {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-content-fixture-"));
  const projectsRoot = path.join(tmpRoot, "projects");
  const projectDirName = "D--Content--ProjectOne";
  const projectDirPath = path.join(projectsRoot, projectDirName);
  const realProjectPath = path.join(tmpRoot, "real-project");
  fs.mkdirSync(projectDirPath, { recursive: true });
  fs.mkdirSync(realProjectPath, { recursive: true });

  const sessionPath = path.join(projectDirPath, "session-only.jsonl");
  fs.writeFileSync(
    sessionPath,
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: "session-only",
        cwd: realProjectPath,
        timestamp: "2026-06-01T10:00:00.000Z",
        message: { role: "user", content: "Hello, this is the first message." }
      })
    ].join("\n") + "\n"
  );

  return { tmpRoot, projectsRoot, projectDirName, realProjectPath };
}

function cleanupContentFixture(fixture: ContentFixture): void {
  fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
}

describe("GET /api/projects/:id/content (CR-UI-25)", () => {
  let fixture: ContentFixture;
  let indexDb: IndexDb;
  let annotationsDb: AnnotationsDb;
  let app: Express;

  beforeEach(() => {
    fixture = buildContentFixture();
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
    cleanupContentFixture(fixture);
  });

  it("prefers README.md when present", async () => {
    fs.writeFileSync(path.join(fixture.realProjectPath, "README.md"), "# Fixture Project\nReal readme text.");
    fs.writeFileSync(path.join(fixture.realProjectPath, "CLAUDE.md"), "# Should be ignored");

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/content`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("readme");
    expect(res.body.content).toContain("Real readme text.");
  });

  it("falls back to CLAUDE.md when there's no README.md", async () => {
    fs.writeFileSync(path.join(fixture.realProjectPath, "CLAUDE.md"), "# Project instructions\nDo the thing.");

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/content`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("claude-md");
    expect(res.body.content).toContain("Do the thing.");
  });

  it("falls back to the earliest session's first user message when neither file exists", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/content`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("first-message");
    expect(res.body.content).toBe("Hello, this is the first message.");
  });

  it("returns {source: 'none', content: null} when there's no README, no CLAUDE.md, and zero sessions", async () => {
    const emptyProjectDirName = "D--Content--EmptyProject";
    fs.mkdirSync(path.join(fixture.projectsRoot, emptyProjectDirName), { recursive: true });

    const res = await request(app).get(`/api/projects/${emptyProjectDirName}/content`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ source: "none", content: null });
  });

  it("an unknown project returns a clean 404", async () => {
    const res = await request(app).get("/api/projects/does-not-exist/content");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});
