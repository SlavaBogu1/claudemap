import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

describe("HTTP API (CR-API-01)", () => {
  let fixture: Fixture;
  let indexDb: IndexDb;
  let annotationsDb: AnnotationsDb;
  let app: Express;
  let openFolderMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fixture = buildFixture();
    indexDb = openIndexDb(":memory:");
    annotationsDb = openAnnotationsDb(":memory:");
    openFolderMock = vi.fn();
    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      openFolder: openFolderMock,
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  it("GET /api/projects returns the fixture project", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: fixture.projectDirName,
      path: fixture.realProjectPath,
      sessionCount: 3
    });
  });

  it("GET /api/projects/:id/sessions returns the fixture's 3 sessions", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    expect(bbb).toMatchObject({
      messageCount: 5,
      gitBranch: "feature/auth-refactor",
      subagentCount: 1,
      touchedMemory: true
    });
  });

  it("GET /api/projects/:id/sessions for an unknown project returns a clean 404", async () => {
    const res = await request(app).get("/api/projects/does-not-exist/sessions");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /api/projects/:id/open-folder calls the mocked OS launch with the resolved real path", async () => {
    const res = await request(app).post(`/api/projects/${fixture.projectDirName}/open-folder`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(openFolderMock).toHaveBeenCalledTimes(1);
    expect(openFolderMock).toHaveBeenCalledWith(fixture.realProjectPath);
  });

  it("POST /api/projects/:id/open-folder for an unknown project returns a clean 404 and never launches", async () => {
    const res = await request(app).post("/api/projects/does-not-exist/open-folder");
    expect(res.status).toBe(404);
    expect(openFolderMock).not.toHaveBeenCalled();
  });
});
