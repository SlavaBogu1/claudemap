import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-UI-28 — hasNotedDescendant on GET /api/projects/:id/sessions: a session shows the note badge
// if it or any of its subagent/memory-touch/tool sub-items has a saved note, even while collapsed
// (i.e. without ever calling .../detail to expand it).

describe("hasNotedDescendant on GET /api/projects/:id/sessions (CR-UI-28)", () => {
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

  it("a session with a direct note on itself shows the badge (regression, CR-UI-18)", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({ content: "Watch this one." });

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const aaa = res.body.find((s: any) => s.id === "session-aaa");
    expect(aaa.hasNotedDescendant).toBe(true);
  });

  it("a session with no direct note but a noted subagent child shows the badge while still collapsed (never expanded via .../detail)", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/subagent/sub1`)
      .send({ content: "This subagent did something interesting." });

    // Never call .../detail — the badge must be derivable from the sessions list alone.
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    expect(bbb.hasNotedDescendant).toBe(true);
  });

  it("a session with a noted memory-touch child shows the badge", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/memoryTouch/${encodeURIComponent(fixture.memoryTopic1Path)}`)
      .send({ content: "Important memory touch." });

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    expect(bbb.hasNotedDescendant).toBe(true);
  });

  it("a session with a noted tool (overflow) child shows the badge", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/tool/toolu_big1`)
      .send({ content: "Big command output worth remembering." });

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    expect(bbb.hasNotedDescendant).toBe(true);
  });

  it("a session with no notes anywhere in it (itself or any sub-item) shows no badge", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    for (const session of res.body) {
      expect(session.hasNotedDescendant).toBe(false);
    }
  });

  it("a note on a different project's/session's item doesn't leak a false-positive badge", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/subagent/sub1`)
      .send({ content: "Only session-bbb should light up." });

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    const aaa = res.body.find((s: any) => s.id === "session-aaa");
    const ccc = res.body.find((s: any) => s.id === "session-ccc");
    expect(aaa.hasNotedDescendant).toBe(false);
    expect(ccc.hasNotedDescendant).toBe(false);
  });
});
