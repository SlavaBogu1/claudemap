import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";

// CR-API-02 — CORS allowlist. Real cross-origin-in-a-real-browser behavior is covered by the
// Playwright checks in indexer/e2e/cors.spec.ts (supertest calls the Express app in-process and
// never goes through actual browser CORS enforcement — see SPRINT1_VALIDATION_REPORT.md). These
// tests instead confirm the exact response headers the server sends, including for a spoofed
// disallowed `Origin` header on a direct HTTP request (acceptance criterion 3).

const ALLOWED_ORIGIN = "http://localhost:5173";
const DISALLOWED_ORIGIN = "http://evil.example.com";

describe("CORS allowlist (CR-API-02)", () => {
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

  it("reflects Access-Control-Allow-Origin for an allowed origin on a simple GET", async () => {
    const res = await request(app).get("/api/projects").set("Origin", ALLOWED_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });

  it("does NOT send Access-Control-Allow-Origin for a disallowed (spoofed) origin", async () => {
    const res = await request(app).get("/api/projects").set("Origin", DISALLOWED_ORIGIN);
    // The server still answers (it doesn't hard-403 — that's the browser's job), but without an
    // Access-Control-Allow-Origin header a real browser refuses to hand the response to JS.
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("a request with no Origin header at all (e.g. curl, server-to-server) is unaffected", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
  });

  it("preflight OPTIONS for POST /api/projects/browse from the allowed origin returns the right headers", async () => {
    const res = await request(app)
      .options("/api/projects/browse")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type");

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("preflight OPTIONS for POST /api/projects/browse from a disallowed origin has no Allow-* headers", async () => {
    const res = await request(app)
      .options("/api/projects/browse")
      .set("Origin", DISALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-methods"]).toBeUndefined();
  });

  it("preflight OPTIONS for POST /:id/open-folder from the allowed origin returns the right headers", async () => {
    const res = await request(app)
      .options(`/api/projects/${fixture.projectDirName}/open-folder`)
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type");

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });
});
