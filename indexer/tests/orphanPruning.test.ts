import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import {
  openIndexDb,
  type IndexDb,
  getSessionDetail,
  getSessionMtime,
  replaceOverflows
} from "../src/db/indexDb.js";
import { openAnnotationsDb, type AnnotationsDb, upsertNote, listNotes, upsertStickItNote, listStickItNotes } from "../src/db/annotationsDb.js";
import { rescan } from "../src/discovery/rescan.js";

// CR-CORE-11 — a subagent/tool-result-overflow/memory-touch/file-history-backup file deleted from
// disk (independent of the session's own .jsonl) must have its stale index.db row pruned on the next
// rescan, mirroring CR-CORE-04's session/memory-file pruning. Critical detail under test: this must
// run even when the parent session's own .jsonl is otherwise mtime-skipped (D13) — the parent's mtime
// never changes just because a sibling sub-item file vanished.

describe("orphaned sub-item pruning (CR-CORE-11)", () => {
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

  it("prunes an orphaned subagent row when only its transcript file is deleted (session-bbb's own .jsonl untouched)", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    let detail = getSessionDetail(db, "session-bbb");
    expect(detail.subagents).toHaveLength(1);

    const mtimeBefore = getSessionMtime(db, fixture.sessionBbbPath);
    fs.rmSync(fixture.subagentSub1TranscriptPath);

    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    const mtimeAfter = getSessionMtime(db, fixture.sessionBbbPath);

    // Regression: the parent session's own file was never re-parsed (its mtime is untouched, and it
    // was correctly mtime-skipped) — yet the orphaned child row was still pruned.
    expect(mtimeAfter).toBe(mtimeBefore);
    expect(stats.sessionsSkipped).toBeGreaterThan(0);
    expect(stats.subagentsDeleted).toBe(1);

    detail = getSessionDetail(db, "session-bbb");
    expect(detail.subagents).toHaveLength(0);
  });

  it("prunes an orphaned tool-result-overflow row when its dump file is deleted", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    let detail = getSessionDetail(db, "session-bbb");
    expect(detail.overflows).toHaveLength(1);

    const mtimeBefore = getSessionMtime(db, fixture.sessionBbbPath);
    fs.rmSync(fixture.overflowFilePath);

    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    expect(getSessionMtime(db, fixture.sessionBbbPath)).toBe(mtimeBefore);
    expect(stats.overflowsDeleted).toBe(1);

    detail = getSessionDetail(db, "session-bbb");
    expect(detail.overflows).toHaveLength(0);
  });

  it("prunes an orphaned session-memory-touch row when the touched memory file is deleted", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    let detail = getSessionDetail(db, "session-bbb");
    expect(detail.memoryTouches).toHaveLength(1);

    const mtimeBefore = getSessionMtime(db, fixture.sessionBbbPath);
    fs.rmSync(fixture.memoryTopic1Path);

    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    expect(getSessionMtime(db, fixture.sessionBbbPath)).toBe(mtimeBefore);
    // CR-CORE-04 also prunes the memory_files row itself; CR-CORE-11 additionally prunes the
    // session's own session_memory_touches row pointing at that same now-gone file.
    expect(stats.memoryFilesDeleted).toBe(1);
    expect(stats.memoryTouchesDeleted).toBe(1);

    detail = getSessionDetail(db, "session-bbb");
    expect(detail.memoryTouches).toHaveLength(0);
  });

  it("prunes only the orphaned file-history-entry row when just one of two backups is deleted", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    let detail = getSessionDetail(db, "session-bbb");
    expect(detail.files).toHaveLength(2);

    const mtimeBefore = getSessionMtime(db, fixture.sessionBbbPath);
    fs.rmSync(fixture.fileHistoryAuthPyBackupPath);

    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    expect(getSessionMtime(db, fixture.sessionBbbPath)).toBe(mtimeBefore);
    expect(stats.fileHistoryEntriesDeleted).toBe(1);

    detail = getSessionDetail(db, "session-bbb");
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0].backupFileName).toBe(fixture.fileHistoryReadmeBackupName);
  });

  it("D16: a user note and a stick-it note on an orphaned subagent survive untouched in annotations.db", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });

    upsertNote(annotationsDb, fixture.projectDirName, "subagent", "sub1", "Worth revisiting.", "markdown");
    upsertStickItNote(annotationsDb, fixture.projectDirName, "subagent", "sub1", "Tagged moment.");

    fs.rmSync(fixture.subagentSub1TranscriptPath);
    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot], annotationsDb, fileHistoryRoot: fixture.fileHistoryRoot });
    expect(stats.subagentsDeleted).toBe(1);

    const notes = listNotes(annotationsDb, fixture.projectDirName);
    expect(notes.some((n) => n.nodeType === "subagent" && n.nodeId === "sub1")).toBe(true);

    const stickItNotes = listStickItNotes(annotationsDb, fixture.projectDirName);
    expect(stickItNotes.some((n) => n.nodeType === "subagent" && n.nodeId === "sub1")).toBe(true);
  });

  it("an unrelated, still-existing overflow row on a different session is untouched by a rescan that prunes another session's orphan", () => {
    // Self-contained two-session scenario (independent of the shared fixture's single subagent-
    // bearing session-bbb): session-x keeps its overflow file, session-y's overflow file is deleted.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-orphan-fixture-"));
    try {
      const projectsRoot = path.join(tmpRoot, "projects");
      const projectDirName = "D--Fixture--TwoSession";
      const projectDirPath = path.join(projectsRoot, projectDirName);
      fs.mkdirSync(projectDirPath, { recursive: true });

      const sessionXPath = path.join(projectDirPath, "session-x.jsonl");
      const sessionYPath = path.join(projectDirPath, "session-y.jsonl");
      fs.writeFileSync(
        sessionXPath,
        JSON.stringify({
          type: "user",
          uuid: "x-u1",
          parentUuid: null,
          sessionId: "session-x",
          cwd: "D:\\Fixture\\TwoSession",
          timestamp: "2026-07-01T10:00:00.000Z",
          message: { role: "user", content: "hello x" }
        }) + "\n"
      );
      fs.writeFileSync(
        sessionYPath,
        JSON.stringify({
          type: "user",
          uuid: "y-u1",
          parentUuid: null,
          sessionId: "session-y",
          cwd: "D:\\Fixture\\TwoSession",
          timestamp: "2026-07-01T11:00:00.000Z",
          message: { role: "user", content: "hello y" }
        }) + "\n"
      );

      const localDb = openIndexDb(":memory:");
      try {
        // First rescan discovers both sessions (no overflows parsed from these plain transcripts).
        rescan({ db: localDb, projectsRoots: [projectsRoot] });

        // Manually attach an overflow row to each session: session-x's file stays on disk,
        // session-y's file is deleted before the next rescan.
        const keptFilePath = path.join(projectDirPath, "kept-overflow.txt");
        const goneFilePath = path.join(projectDirPath, "gone-overflow.txt");
        fs.writeFileSync(keptFilePath, "kept content");
        fs.writeFileSync(goneFilePath, "gone content");

        replaceOverflows(localDb, "session-x", [{ toolUseId: "t1", filePath: keptFilePath }]);
        replaceOverflows(localDb, "session-y", [{ toolUseId: "t2", filePath: goneFilePath }]);

        fs.rmSync(goneFilePath);

        const mtimeXBefore = getSessionMtime(localDb, sessionXPath);
        const mtimeYBefore = getSessionMtime(localDb, sessionYPath);

        // Second rescan: both sessions' .jsonl files are unchanged (mtime-skipped), so this proves
        // orphan-pruning ran independently of D13's skip for both sessions simultaneously.
        const stats = rescan({ db: localDb, projectsRoots: [projectsRoot] });

        expect(getSessionMtime(localDb, sessionXPath)).toBe(mtimeXBefore);
        expect(getSessionMtime(localDb, sessionYPath)).toBe(mtimeYBefore);
        expect(stats.overflowsDeleted).toBe(1);

        const xDetail = getSessionDetail(localDb, "session-x");
        const yDetail = getSessionDetail(localDb, "session-y");
        expect(xDetail.overflows).toHaveLength(1);
        expect(xDetail.overflows[0].filePath).toBe(keptFilePath);
        expect(yDetail.overflows).toHaveLength(0);
      } finally {
        localDb.close();
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
