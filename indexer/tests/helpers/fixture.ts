import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Builds a fixture "claude home"-like directory tree in a fresh temp dir, mirroring the real
 * on-disk structure (REQUIREMENTS/knowledge/CLAUDE_SESSION_FORMAT.md) without any dependency on a
 * real ~/.claude directory. Returns paths needed by the tests.
 *
 * Structure:
 *   {tmp}/projects/D--Fixture--ProjectOne/
 *     session-aaa.jsonl        — plain 2-message session, slug present
 *     session-bbb.jsonl        — cwd only on first line; spawns a subagent; writes to memory/;
 *                                 has a tool-result overflow reference
 *     session-bbb/
 *       subagents/agent-sub1.meta.json
 *       tool-results/tooluse-overflow-1.txt
 *     session-ccc.jsonl        — one deliberately malformed line mixed with valid lines
 *     memory/
 *       MEMORY.md
 *       topic1.md
 */
export interface Fixture {
  tmpRoot: string;
  projectsRoot: string;
  projectDirName: string;
  projectDirPath: string;
  realProjectPath: string;
  sessionAaaPath: string;
  sessionBbbPath: string;
  sessionCccPath: string;
}

export function buildFixture(): Fixture {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-fixture-"));
  const projectsRoot = path.join(tmpRoot, "projects");
  const projectDirName = "D--Fixture--ProjectOne";
  const projectDirPath = path.join(projectsRoot, projectDirName);
  const realProjectPath = "D:\\Fixture\\ProjectOne";

  fs.mkdirSync(projectDirPath, { recursive: true });

  // --- session aaa: plain session with a slug -----------------------------------------------
  const sessionAaaPath = path.join(projectDirPath, "session-aaa.jsonl");
  writeLines(sessionAaaPath, [
    line({
      type: "user",
      uuid: "aaa-u1",
      parentUuid: null,
      sessionId: "session-aaa",
      cwd: realProjectPath,
      gitBranch: "main",
      slug: "fizzy-moseying-sloth",
      timestamp: "2026-06-01T10:00:00.000Z",
      message: { role: "user", content: "Hello, let's start working on the widget feature." }
    }),
    line({
      type: "assistant",
      uuid: "aaa-a1",
      parentUuid: "aaa-u1",
      sessionId: "session-aaa",
      cwd: realProjectPath,
      gitBranch: "main",
      timestamp: "2026-06-01T10:01:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Sure, let's do it." }] }
    })
  ]);

  // --- session bbb: cwd only on first line; subagent + memory write + overflow --------------
  const sessionBbbPath = path.join(projectDirPath, "session-bbb.jsonl");
  const subagentsDir = path.join(projectDirPath, "session-bbb", "subagents");
  const toolResultsDir = path.join(projectDirPath, "session-bbb", "tool-results");
  fs.mkdirSync(subagentsDir, { recursive: true });
  fs.mkdirSync(toolResultsDir, { recursive: true });

  const overflowFilePath = path.join(toolResultsDir, "tooluse-overflow-1.txt");
  fs.writeFileSync(overflowFilePath, "Full overflow content that was too large to inline.\n");

  writeLines(sessionBbbPath, [
    line({
      type: "user",
      uuid: "bbb-u1",
      parentUuid: null,
      sessionId: "session-bbb",
      cwd: realProjectPath, // cwd present only here
      gitBranch: "feature/auth-refactor",
      timestamp: "2026-06-02T09:00:00.000Z",
      message: { role: "user", content: "Let's refactor the auth module." }
    }),
    line({
      type: "assistant",
      uuid: "bbb-a1",
      parentUuid: "bbb-u1",
      sessionId: "session-bbb",
      // cwd deliberately omitted on this and all later entries
      gitBranch: "feature/auth-refactor",
      timestamp: "2026-06-02T09:01:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_task1",
            name: "Task",
            input: { description: "Refactor helper", subagent_type: "general-purpose" }
          }
        ]
      }
    }),
    line({
      type: "assistant",
      uuid: "bbb-a2",
      parentUuid: "bbb-a1",
      sessionId: "session-bbb",
      gitBranch: "feature/auth-refactor",
      timestamp: "2026-06-02T09:02:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_mem1",
            name: "Write",
            input: {
              file_path: "D:\\Fixture\\ProjectOne\\memory\\topic1.md",
              content: "Auth refactor notes."
            }
          }
        ]
      }
    }),
    line({
      type: "assistant",
      uuid: "bbb-a3",
      parentUuid: "bbb-a2",
      sessionId: "session-bbb",
      gitBranch: "feature/auth-refactor",
      timestamp: "2026-06-02T09:03:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_big1", name: "Bash", input: { command: "big-command" } }]
      }
    }),
    line({
      type: "user",
      uuid: "bbb-u2",
      parentUuid: "bbb-a3",
      sessionId: "session-bbb",
      gitBranch: "feature/auth-refactor",
      timestamp: "2026-06-02T09:04:00.000Z",
      isMeta: false,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_big1",
            content: `<persisted-output>\nFull output saved to: ${overflowFilePath}\n\nPreview (first 2KB): big command output preview...`
          }
        ]
      }
    })
  ]);

  fs.writeFileSync(
    path.join(subagentsDir, "agent-sub1.meta.json"),
    JSON.stringify({
      agentType: "general-purpose",
      description: "Refactor helper",
      toolUseId: "toolu_task1",
      agentId: "sub1"
    })
  );

  // --- session ccc: one malformed line mixed with valid lines --------------------------------
  const sessionCccPath = path.join(projectDirPath, "session-ccc.jsonl");
  const validLine1 = line({
    type: "user",
    uuid: "ccc-u1",
    parentUuid: null,
    sessionId: "session-ccc",
    cwd: realProjectPath,
    gitBranch: "main",
    timestamp: "2026-06-03T08:00:00.000Z",
    message: { role: "user", content: "Quick question about the build script." }
  });
  const malformedLine = `{"type":"user","uuid":"ccc-bad", this is not valid JSON`;
  const validLine2 = line({
    type: "assistant",
    uuid: "ccc-a1",
    parentUuid: "ccc-u1",
    sessionId: "session-ccc",
    cwd: realProjectPath,
    gitBranch: "main",
    timestamp: "2026-06-03T08:01:00.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "It runs `npm run build`." }] }
  });
  writeLines(sessionCccPath, [validLine1, malformedLine, validLine2], /* rawLines */ true);

  // --- memory/ ---------------------------------------------------------------------------------
  const memoryDir = path.join(projectDirPath, "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(memoryDir, "MEMORY.md"),
    [
      "---",
      "name: Project Memory Index",
      "description: Index of memory entries for this project.",
      "metadata:",
      "  type: project",
      "---",
      "",
      "# Memory"
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(memoryDir, "topic1.md"),
    [
      "---",
      "name: Auth Notes",
      "description: Notes about the auth module refactor.",
      "metadata:",
      "  type: reference",
      "---",
      "",
      "Auth refactor notes body."
    ].join("\n")
  );

  return {
    tmpRoot,
    projectsRoot,
    projectDirName,
    projectDirPath,
    realProjectPath,
    sessionAaaPath,
    sessionBbbPath,
    sessionCccPath
  };
}

export function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
}

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function writeLines(filePath: string, lines: string[], rawLines = false): void {
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  void rawLines;
}
