import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFixture, cleanupFixture, type Fixture } from "./helpers/fixture.js";
import { openIndexDb, type IndexDb, listProjects, listSessions } from "../src/db/indexDb.js";
import { rescan } from "../src/discovery/rescan.js";
import { parseSessionFile } from "../src/parsing/sessionParser.js";
import type { Logger } from "../src/logger.js";

function silentLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (m: string) => warnings.push(m),
    info: () => {}
  };
}

describe("ingestion (CR-CORE-01)", () => {
  let fixture: Fixture;
  let db: IndexDb;

  beforeEach(() => {
    fixture = buildFixture();
    db = openIndexDb(":memory:");
    rescan({ db, projectsRoots: [fixture.projectsRoot], logger: silentLogger() });
  });

  afterEach(() => {
    db.close();
    cleanupFixture(fixture);
  });

  it("produces one project record with the resolved real path and correct session count", () => {
    const projects = listProjects(db);
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(fixture.projectDirName);
    expect(projects[0].path).toBe(fixture.realProjectPath);
    expect(projects[0].sessionCount).toBe(3);
    expect(projects[0].lastActiveAt).toBe("2026-06-03T08:01:00.000Z");
  });

  it("produces correct session records", () => {
    const sessions = listSessions(db, fixture.projectDirName);
    expect(sessions).toHaveLength(3);

    const aaa = sessions.find((s) => s.id === "session-aaa")!;
    expect(aaa.preview).toBe("fizzy-moseying-sloth");
    expect(aaa.messageCount).toBe(2);
    expect(aaa.gitBranch).toBe("main");
    expect(aaa.subagentCount).toBe(0);
    expect(aaa.touchedMemory).toBe(false);
    expect(aaa.startedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(aaa.endedAt).toBe("2026-06-01T10:01:00.000Z");

    const bbb = sessions.find((s) => s.id === "session-bbb")!;
    expect(bbb.messageCount).toBe(5);
    expect(bbb.gitBranch).toBe("feature/auth-refactor");
    expect(bbb.subagentCount).toBe(1);
    expect(bbb.touchedMemory).toBe(true);
    expect(bbb.preview).toBe("Let's refactor the auth module.");

    const ccc = sessions.find((s) => s.id === "session-ccc")!;
    expect(ccc.messageCount).toBe(2); // malformed line excluded
    expect(ccc.preview).toBe("Quick question about the build script.");
    expect(ccc.subagentCount).toBe(0);
    expect(ccc.touchedMemory).toBe(false);
  });

  it("records the subagent invocation joined to its parent session", () => {
    const row = db
      .prepare(`SELECT * FROM subagents WHERE session_id = 'session-bbb'`)
      .get() as any;
    expect(row).toBeTruthy();
    expect(row.agent_id).toBe("sub1");
    expect(row.agent_type).toBe("general-purpose");
    expect(row.description).toBe("Refactor helper");
    expect(row.tool_use_id).toBe("toolu_task1");
  });

  it("records the tool-result overflow file reference, not inline content", () => {
    const row = db
      .prepare(`SELECT * FROM tool_result_overflows WHERE session_id = 'session-bbb'`)
      .get() as any;
    expect(row).toBeTruthy();
    expect(row.tool_use_id).toBe("toolu_big1");
    expect(row.file_path).toContain("tooluse-overflow-1.txt");
  });

  it("parses memory/*.md frontmatter per project", () => {
    const rows = db
      .prepare(`SELECT * FROM memory_files WHERE project_id = ? ORDER BY file_path`)
      .all(fixture.projectDirName) as any[];
    expect(rows).toHaveLength(2);

    const topic = rows.find((r) => r.file_path.endsWith("topic1.md"))!;
    expect(topic.name).toBe("Auth Notes");
    expect(topic.description).toBe("Notes about the auth module refactor.");
    expect(topic.type).toBe("reference");

    const index = rows.find((r) => r.file_path.endsWith("MEMORY.md"))!;
    expect(index.name).toBe("Project Memory Index");
    expect(index.type).toBe("project");
  });

  it("resolves the project's real folder path even when cwd is missing on later entries", () => {
    const logger = silentLogger();
    const parsed = parseSessionFile(fixture.sessionBbbPath, "session-bbb", logger);
    // Only the first line of session-bbb carries `cwd` — every later line omits it.
    expect(parsed.cwd).toBe(fixture.realProjectPath);
  });

  it("skips a malformed JSONL line with a logged warning, while the rest of the file still ingests", () => {
    const logger = silentLogger();
    const parsed = parseSessionFile(fixture.sessionCccPath, "session-ccc", logger);
    expect(parsed.messageCount).toBe(2);
    expect(logger.warnings.some((w) => w.includes("malformed"))).toBe(true);
  });
});
