import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import request from "supertest";
import type { Express } from "express";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb } from "../src/db/indexDb.js";
import { openAnnotationsDb, listClaudeMapNotes, type AnnotationsDb } from "../src/db/annotationsDb.js";
import { createApp } from "../src/api/app.js";
import { parseSessionFile } from "../src/parsing/sessionParser.js";

// CR-CORE-03 — the "claude-map" tagging skill posts a literal `[claude-map] <text>` message into a
// live session's transcript; the Indexer aggregates every such marker found in one session into a
// single, view-only, ingest-written note (a table separate from the user-editable `notes`, CR-UI-08).

/** Appends a `[claude-map] <text>` marker as an ordinary user-turn message to a session file. */
function appendMarkerMessage(sessionFilePath: string, sessionId: string, uuid: string, text: string): void {
  const entry = {
    type: "user",
    uuid,
    parentUuid: null,
    sessionId,
    gitBranch: "main",
    timestamp: "2026-06-01T11:00:00.000Z",
    message: { role: "user", content: `[claude-map] ${text}` }
  };
  fs.appendFileSync(sessionFilePath, JSON.stringify(entry) + "\n");
  // Windows FS mtime resolution can be coarse — force a clearly later mtime so the incremental
  // rescan (D13) actually re-parses this file (same technique as tests/rescan.test.ts).
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(sessionFilePath, future, future);
}

/**
 * Appends the *envelope* entry Claude Code's slash-command mechanism writes for a real invocation —
 * `isMeta` is absent/false, content carries the raw `<command-message>`/`<command-name>`/
 * `<command-args>` tags, and it never contains the literal `[claude-map]` marker text (that lands in
 * a separate, immediately-following `isMeta: true` entry — see `appendIsMetaMarkerMessage`).
 */
function appendCommandEnvelopeMessage(sessionFilePath: string, sessionId: string, uuid: string, rawArgs: string): void {
  const entry = {
    type: "user",
    uuid,
    parentUuid: null,
    sessionId,
    gitBranch: "main",
    timestamp: "2026-06-01T11:00:00.000Z",
    message: {
      role: "user",
      content: `<command-message>claude-map</command-message><command-name>/claude-map</command-name><command-args>${rawArgs}</command-args>`
    }
  };
  fs.appendFileSync(sessionFilePath, JSON.stringify(entry) + "\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(sessionFilePath, future, future);
}

/**
 * Appends the `isMeta: true` entry a real slash-command/skill invocation produces — this is where
 * the literal, expanded `[claude-map] <text>` marker text actually lands (BACKLOG.md CR-CORE-03,
 * 2026-07-04 re-validation-failed note). Content shape is a plain `[{"type":"text","text":"..."}]`
 * array, identical to a normal text message.
 */
function appendIsMetaMarkerMessage(sessionFilePath: string, sessionId: string, uuid: string, text: string): void {
  const entry = {
    type: "user",
    uuid,
    parentUuid: null,
    sessionId,
    isMeta: true,
    gitBranch: "main",
    timestamp: "2026-06-01T11:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: `[claude-map] ${text}\n` }] }
  };
  fs.appendFileSync(sessionFilePath, JSON.stringify(entry) + "\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(sessionFilePath, future, future);
}

describe("claude-map notes (CR-CORE-03)", () => {
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

  it("a session with no markers returns nothing for that session", async () => {
    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("multiple markers in one session aggregate into a single row", async () => {
    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm1", "First tagged moment.");
    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm2", "Second tagged moment.");

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      projectId: fixture.projectDirName,
      nodeType: "session",
      nodeId: "session-aaa"
    });
    expect(res.body[0].content).toContain("First tagged moment.");
    expect(res.body[0].content).toContain("Second tagged moment.");
    expect(res.body[0].createdAt).toBeTruthy();
    expect(res.body[0].updatedAt).toBe(res.body[0].createdAt);
    // Never has a `format` field — that's a `notes`-only concept (CR-UI-08), not mirrored here.
    expect(res.body[0].format).toBeUndefined();
  });

  it("a rescan after a new marker is added updates the row's content correctly", async () => {
    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm1", "Initial tag.");
    const first = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(first.body).toHaveLength(1);
    expect(first.body[0].content).toBe("Initial tag.");
    const firstCreatedAt = first.body[0].createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm2", "Follow-up tag.");
    const second = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(second.body).toHaveLength(1);
    expect(second.body[0].content).toContain("Initial tag.");
    expect(second.body[0].content).toContain("Follow-up tag.");
    expect(second.body[0].createdAt).toBe(firstCreatedAt); // preserved across the wholesale replace
    expect(second.body[0].updatedAt).not.toBe(first.body[0].updatedAt);
  });

  it("claude-map notes are stored separately from user notes — no collision, no overwrite either way", async () => {
    await request(app)
      .put(`/api/projects/${fixture.projectDirName}/notes/session/session-aaa`)
      .send({ content: "My own hand-written note." });
    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm1", "Auto-tagged moment.");

    // Trigger the rescan (any GET does) and fetch both.
    const notesRes = await request(app).get(`/api/projects/${fixture.projectDirName}/notes`);
    const cmRes = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);

    expect(notesRes.body).toHaveLength(1);
    expect(notesRes.body[0].content).toBe("My own hand-written note.");
    expect(cmRes.body).toHaveLength(1);
    expect(cmRes.body[0].content).toBe("Auto-tagged moment.");
  });

  it("a session whose only marker line is removed and re-parsed no longer returns a stale note", async () => {
    // Simulates the wholesale-replace guarantee: rewrite the file without markers, re-parse.
    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm1", "Temporary tag.");
    const withMarker = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(withMarker.body).toHaveLength(1);

    const original = fs.readFileSync(fixture.sessionAaaPath, "utf-8");
    const withoutMarkerLine = original
      .split("\n")
      .filter((l) => !l.includes("[claude-map]"))
      .join("\n");
    fs.writeFileSync(fixture.sessionAaaPath, withoutMarkerLine);
    const future = new Date(Date.now() + 120_000);
    fs.utimesSync(fixture.sessionAaaPath, future, future);

    const afterRemoval = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(afterRemoval.body).toHaveLength(0);
  });

  it("unknown project id returns a clean 404", async () => {
    const res = await request(app).get("/api/projects/does-not-exist/claude-map-notes");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("claude_map_notes survives an index.db rescan/rebuild untouched, same guarantee as notes (D16)", async () => {
    appendMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-cm1", "Durable tag.");
    await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`); // triggers rescan

    // annotations.db (":memory:" here) is a separate handle from index.db — deleting/recreating
    // index.db must never touch it. Directly assert the durable store still has the row.
    const notes = listClaudeMapNotes(annotationsDb, fixture.projectDirName);
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("Durable tag.");
  });

  // --- Regression: real slash-command invocation shape (2026-07-04 re-validation-failed defect) ---

  it("a real invocation's separate isMeta entry IS aggregated as a claude-map marker (regression)", async () => {
    // Mirrors the real, live-verified two-entry shape: a marker-less command envelope entry
    // immediately followed by a separate isMeta:true entry carrying the actual marker text.
    appendCommandEnvelopeMessage(fixture.sessionAaaPath, "session-aaa", "aaa-env1", "Fixed the flaky test");
    appendIsMetaMarkerMessage(fixture.sessionAaaPath, "session-aaa", "aaa-meta1", "Fixed the flaky test");

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toContain("Fixed the flaky test");
  });

  it("a command envelope entry with no literal marker text is not spuriously picked up", async () => {
    // The envelope entry alone (no isMeta follow-up) contains <command-args> raw text but never the
    // literal "[claude-map]" marker — it must not be double-counted or falsely detected.
    appendCommandEnvelopeMessage(fixture.sessionAaaPath, "session-aaa", "aaa-env2", "Fixed the flaky test");

    const res = await request(app).get(`/api/projects/${fixture.projectDirName}/claude-map-notes`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("isMeta entries stay excluded from preview/firstUserText and tool-result overflow detection (unchanged)", () => {
    // Direct parser-level check (not just the aggregation endpoint) that the isMeta exclusion is
    // still correctly applied to the two pieces of logic it was always meant to gate — only marker
    // extraction was widened to include isMeta entries.
    appendIsMetaMarkerMessage(fixture.sessionBbbPath, "session-bbb", "bbb-meta1", "Should not affect preview.");
    const fakeOverflowIsMetaEntry = {
      type: "user",
      uuid: "bbb-meta2",
      parentUuid: null,
      sessionId: "session-bbb",
      isMeta: true,
      timestamp: "2026-06-02T09:05:00.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_fake", content: "Full output saved to: /fake/path.txt" }
        ]
      }
    };
    fs.appendFileSync(fixture.sessionBbbPath, JSON.stringify(fakeOverflowIsMetaEntry) + "\n");

    const logger = { warn: () => {}, info: () => {} };
    const parsed = parseSessionFile(fixture.sessionBbbPath, "session-bbb", logger);

    // session-bbb has no slug, so preview falls back to firstUserText — must still be the original
    // first non-isMeta user message, untouched by either isMeta entry appended above.
    expect(parsed.preview).toBe("Let's refactor the auth module.");
    expect(parsed.claudeMapNotes).toContain("Should not affect preview.");
    // Only the pre-existing non-isMeta overflow reference is recorded — the isMeta "overflow-shaped"
    // entry above must not be scanned for tool-result overflows.
    expect(parsed.overflows).toHaveLength(1);
    expect(parsed.overflows[0].filePath).toContain("tooluse-overflow-1.txt");
  });
});
