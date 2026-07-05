import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { buildDesktopFixture, cleanupDesktopFixture, type DesktopFixture } from "./helpers/desktopFixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-CORE-06 — Claude Desktop Cowork/Chat session discovery, Chat-vs-Cowork classification (D26),
// Cowork grouping by Space name, and the GET /api/projects/project-groups picker endpoint.

describe("Desktop Cowork/Chat sessions (CR-CORE-06)", () => {
  let fixture: Fixture;
  let desktopFixture: DesktopFixture;
  let indexDb: IndexDb;
  let annotationsDb: AnnotationsDb;
  let app: Express;

  beforeEach(() => {
    fixture = buildFixture();
    desktopFixture = buildDesktopFixture();
    indexDb = openIndexDb(":memory:");
    annotationsDb = openAnnotationsDb(":memory:");
    app = createApp({
      indexDb,
      annotationsDb,
      defaultProjectsRoot: fixture.projectsRoot,
      desktopSessionsRoot: desktopFixture.desktopSessionsRoot,
      openFolder: () => {},
      logger: { warn: () => {}, info: () => {} }
    });
  });

  afterEach(() => {
    indexDb.close();
    annotationsDb.close();
    cleanupFixture(fixture);
    cleanupDesktopFixture(desktopFixture);
  });

  it("GET /api/projects/project-groups groups Code/Cowork/Chat correctly", async () => {
    const res = await request(app).get("/api/projects/project-groups");
    expect(res.status).toBe(200);

    expect(res.body.code).toEqual([
      { id: fixture.projectDirName, name: fixture.realProjectPath, sessionCount: 3 }
    ]);

    // (D26) Cowork grouped by Space name: space-a has 2 sessions, space-b has 1.
    const cowork = [...res.body.cowork].sort((a: any, b: any) => a.name.localeCompare(b.name));
    expect(cowork).toEqual([
      { id: `cowork:${desktopFixture.spaceAId}`, name: "EW market", sessionCount: 2 },
      { id: `cowork:${desktopFixture.spaceBId}`, name: "Vendor Intelligence", sessionCount: 1 }
    ]);

    // (D26) Chat sessions have no spaceId — one ungrouped pseudo-project per session.
    expect(res.body.chat).toEqual([
      { id: "chat:local_sess-chat-1", name: "Write Team Experience Summary", sessionCount: 1 }
    ]);
  });

  it("REGRESSION: GET /api/projects (existing, Code-only endpoint) is completely unaffected by desktop discovery", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(fixture.projectDirName);
  });

  it("REGRESSION: existing Code session fields/counts are unchanged with desktop discovery also running", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/sessions`);
    expect(res.status).toBe(200);
    const bbb = res.body.find((s: any) => s.id === "session-bbb");
    expect(bbb).toMatchObject({ subagentCount: 1, memoryTouchCount: 1, toolResultCount: 1, fileCount: 2 });
  });

  it("counts only top-level user/assistant turns for a Cowork session, excluding the nested sub-conversation turn and the system entry", async () => {
    const res = await request(app).get(`/api/projects/cowork:${desktopFixture.spaceAId}/sessions`);
    expect(res.status).toBe(200);
    const a1 = res.body.find((s: any) => s.id === "local_sess-cowork-a1");
    // audit.jsonl has: 1 system, 1 user, 1 assistant, 1 nested (parent_tool_use_id) user = 2 top-level.
    expect(a1.messageCount).toBe(2);
  });

  it("counts a plain 2-turn Cowork session correctly", async () => {
    const res = await request(app).get(`/api/projects/cowork:${desktopFixture.spaceAId}/sessions`);
    const a2 = res.body.find((s: any) => s.id === "local_sess-cowork-a2");
    expect(a2.messageCount).toBe(2);
  });

  it("a Chat pseudo-project's GET .../sessions returns exactly its one session with the correct message count", async () => {
    const res = await request(app).get("/api/projects/chat:local_sess-chat-1/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: "local_sess-chat-1", messageCount: 2 });
  });

  it("GET .../sessions/:sessionId/content reuses the existing content parser for a Cowork session, excluding the nested sub-conversation turn", async () => {
    const res = await request(app).get(
      `/api/projects/cowork:${desktopFixture.spaceAId}/sessions/local_sess-cowork-a1/content`
    );
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      { role: "user", text: "Fixture user turn.", timestamp: "2026-06-20T09:00:10.000Z" },
      { role: "assistant", text: "Fixture assistant turn.", timestamp: "2026-06-20T09:00:20.000Z" }
    ]);
  });

  it("GET .../detail returns empty substructure arrays for a Cowork/Chat session, not an error (no subagent/memory/tool/file parity built this sprint)", async () => {
    const res = await request(app).get(
      `/api/projects/cowork:${desktopFixture.spaceAId}/sessions/local_sess-cowork-a1/detail`
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subagents: [], memoryTouches: [], overflows: [], files: [] });
  });

  it("an incremental rescan skips re-parsing an unchanged desktop session (D13)", async () => {
    const first = await request(app).get("/api/projects/project-groups");
    expect(first.status).toBe(200);
    // Second call re-triggers doRescan(); audit.jsonl/meta mtimes are unchanged, so this should be a
    // no-op re-read, not a crash or a duplicate/changed count.
    const second = await request(app).get("/api/projects/project-groups");
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("out-of-scope directories (rpm, .project-cache, skills-plugin) never produce spurious sessions", async () => {
    const res = await request(app).get("/api/projects/project-groups");
    const totalDesktopSessions =
      res.body.cowork.reduce((n: number, g: any) => n + g.sessionCount, 0) +
      res.body.chat.reduce((n: number, g: any) => n + g.sessionCount, 0);
    // Exactly the 4 fixture sessions (2 in space-a, 1 in space-b, 1 chat) — rpm/.project-cache/
    // skills-plugin content must never be miscounted as additional sessions.
    expect(totalDesktopSessions).toBe(4);
  });
});
