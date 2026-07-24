import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import {
  openIndexDb,
  type IndexDb,
  listSessions,
  sessionExists,
  memoryFileExists,
  listSessionIdsForProject,
  listMemoryFilePathsForProject
} from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb, upsertNote, listNotes, upsertStickItNote, listStickItNotes } from "../src/db/annotationsDb.js";
import { rescan } from "../src/discovery/rescan.js";

// CR-CORE-04 — a session/memory file deleted from disk must have its stale index.db rows pruned on
// the next rescan (wrong session counts, Content-tab read errors otherwise). D16 invariant:
// annotations.db (notes, stick-it notes) must NEVER be touched by this pruning — a note on a
// since-deleted session must survive untouched in case the file is later restored/renamed.

describe("deleted-session / deleted-memory-file pruning (CR-CORE-04)", () => {
  let fixture: Fixture;
  let db: IndexDb;
  let annotationsDb: AnnotationsDb;

  beforeEach(() => {
    fixture = buildFixture();
    db = openIndexDb(":memory:");
    annotationsDb = openAnnotationsDb(":memory:");
  });

  afterEach(() => {
    db.close();
    annotationsDb.close();
    cleanupFixture(fixture);
  });

  it("deletes a removed session's row and all of its child rows (subagents, overflows, memory touches)", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });
    expect(sessionExists(db, fixture.projectDirName, "session-bbb")).toBe(true);

    // session-bbb has a subagent, a memory touch, and a tool-result overflow (see fixture.ts) —
    // exercises all three child tables in one delete.
    fs.rmSync(fixture.sessionBbbPath);

    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });
    expect(stats.sessionsDeleted).toBe(1);
    expect(sessionExists(db, fixture.projectDirName, "session-bbb")).toBe(false);

    const subagentRows = db.prepare(`SELECT * FROM subagents WHERE session_id = ?`).all("session-bbb");
    const overflowRows = db.prepare(`SELECT * FROM tool_result_overflows WHERE session_id = ?`).all("session-bbb");
    const touchRows = db.prepare(`SELECT * FROM session_memory_touches WHERE session_id = ?`).all("session-bbb");
    expect(subagentRows).toHaveLength(0);
    expect(overflowRows).toHaveLength(0);
    expect(touchRows).toHaveLength(0);
  });

  it("D16: a user note and a stick-it note on a since-deleted session survive untouched in annotations.db", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    upsertNote(annotationsDb, fixture.projectDirName, "session", "session-bbb", "Revisit this later.", "markdown");
    upsertStickItNote(annotationsDb, fixture.projectDirName, "session", "session-bbb", "Tagged moment.");

    fs.rmSync(fixture.sessionBbbPath);
    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    expect(stats.sessionsDeleted).toBe(1);
    expect(sessionExists(db, fixture.projectDirName, "session-bbb")).toBe(false);

    // The note/stick-it note must still exist, completely unaffected by the index.db pruning.
    const notes = listNotes(annotationsDb, fixture.projectDirName);
    expect(notes.some((n) => n.nodeType === "session" && n.nodeId === "session-bbb")).toBe(true);

    const stickItNotes = listStickItNotes(annotationsDb, fixture.projectDirName);
    expect(stickItNotes.some((n) => n.nodeType === "session" && n.nodeId === "session-bbb")).toBe(true);
  });

  it("an unrelated still-existing session is untouched by a rescan that prunes a different, deleted session", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });
    const before = listSessions(db, fixture.projectDirName).find((s) => s.id === "session-aaa")!;

    fs.rmSync(fixture.sessionBbbPath);
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    expect(sessionExists(db, fixture.projectDirName, "session-aaa")).toBe(true);
    const after = listSessions(db, fixture.projectDirName).find((s) => s.id === "session-aaa")!;
    expect(after).toEqual(before);
    expect(sessionExists(db, fixture.projectDirName, "session-ccc")).toBe(true);
  });

  it("deletes a removed memory file's row", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });
    expect(memoryFileExists(db, fixture.projectDirName, fixture.memoryTopic1Path)).toBe(true);

    fs.rmSync(fixture.memoryTopic1Path);
    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    expect(stats.memoryFilesDeleted).toBe(1);
    expect(memoryFileExists(db, fixture.projectDirName, fixture.memoryTopic1Path)).toBe(false);
  });

  it("a deleted memory file's dependent session_memory_touches / note-badge implications update correctly", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    fs.rmSync(fixture.memoryTopic1Path);
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    // session-bbb's touched_memory flag (set at parse time, untouched by any pruning pass) still
    // reports the session touched memory. Its session_memory_touches row itself, however, is now
    // pruned by CR-CORE-11's orphan-check (the touch's own backing file is gone) — superseding the
    // pre-CR-CORE-11 expectation that the dangling touch row would survive.
    const sessions = listSessions(db, fixture.projectDirName);
    const bbb = sessions.find((s) => s.id === "session-bbb")!;
    expect(bbb.touchedMemory).toBe(true);
    expect(bbb.memoryTouchCount).toBe(0);
    expect(memoryFileExists(db, fixture.projectDirName, fixture.memoryTopic1Path)).toBe(false);
  });

  it("deleting the entire memory/ directory prunes every previously-indexed memory file for that project", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });
    const beforeCount = listMemoryFilePathsForProject(db, fixture.projectDirName).length;
    expect(beforeCount).toBeGreaterThan(0);

    fs.rmSync(path.join(fixture.projectDirPath, "memory"), { recursive: true, force: true });
    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    expect(stats.memoryFilesDeleted).toBe(beforeCount);
    expect(listMemoryFilePathsForProject(db, fixture.projectDirName)).toHaveLength(0);
  });

  it("listSessionIdsForProject reflects deletions immediately after pruning", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });
    expect(listSessionIdsForProject(db, fixture.projectDirName).sort()).toEqual(
      ["session-aaa", "session-bbb", "session-ccc"].sort()
    );

    fs.rmSync(fixture.sessionCccPath);
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb });

    expect(listSessionIdsForProject(db, fixture.projectDirName).sort()).toEqual(["session-aaa", "session-bbb"].sort());
  });
});
