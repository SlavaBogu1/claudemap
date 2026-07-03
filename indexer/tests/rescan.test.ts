import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb, listSessions } from "../src/db/indexDb.js";
import { rescan } from "../src/discovery/rescan.js";

describe("incremental on-demand rescan (D13)", () => {
  let fixture: Fixture;
  let db: IndexDb;

  beforeEach(() => {
    fixture = buildFixture();
    db = openIndexDb(":memory:");
  });

  afterEach(() => {
    db.close();
    cleanupFixture(fixture);
  });

  it("first rescan parses every session and memory file", () => {
    const stats = rescan({ db, projectsRoots: [fixture.projectsRoot] });
    expect(stats.sessionsParsed).toBe(3);
    expect(stats.sessionsSkipped).toBe(0);
    expect(stats.memoryFilesParsed).toBe(2);
  });

  it("re-running rescan with no file changes re-parses nothing", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot] });
    const second = rescan({ db, projectsRoots: [fixture.projectsRoot] });
    expect(second.sessionsParsed).toBe(0);
    expect(second.sessionsSkipped).toBe(3);
    expect(second.memoryFilesParsed).toBe(0);
  });

  it("touching only one session file causes only that file to be re-parsed", () => {
    rescan({ db, projectsRoots: [fixture.projectsRoot] });

    // Append a new assistant message to session-aaa only, and force a clearly-different mtime
    // (Windows FS mtime resolution can be coarse, so set it explicitly rather than relying on wall clock).
    const appended = JSON.stringify({
      type: "assistant",
      uuid: "aaa-a2",
      parentUuid: "aaa-a1",
      sessionId: "session-aaa",
      cwd: fixture.realProjectPath,
      gitBranch: "main",
      timestamp: "2026-06-01T10:02:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "One more thing." }] }
    });
    fs.appendFileSync(fixture.sessionAaaPath, appended + "\n");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(fixture.sessionAaaPath, future, future);

    const third = rescan({ db, projectsRoots: [fixture.projectsRoot] });
    expect(third.sessionsParsed).toBe(1);
    expect(third.sessionsSkipped).toBe(2);

    const sessions = listSessions(db, fixture.projectDirName);
    const aaa = sessions.find((s) => s.id === "session-aaa")!;
    expect(aaa.messageCount).toBe(3);
    expect(aaa.endedAt).toBe("2026-06-01T10:02:00.000Z");
  });
});
