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
 *       subagents/agent-sub1.jsonl   — subagent's own transcript (IX-5.1: real data always has both)
 *       tool-results/tooluse-overflow-1.txt
 *     session-ccc.jsonl        — one deliberately malformed line mixed with valid lines
 *     memory/
 *       MEMORY.md
 *       topic1.md
 */
export interface Fixture {
  tmpRoot: string;
  projectsRoot: string;
  fileHistoryRoot: string;
  /**
   * (CR-CORE-06) Deliberately never created — `rescanDesktopSessions` treats a missing root as a
   * no-op (no Claude Desktop data on this "machine"), so tests that don't care about Cowork/Chat
   * sessions get a fast, isolated no-op instead of accidentally scanning this machine's real
   * `%APPDATA%\Claude\local-agent-mode-sessions` on every GET (slow AND touches real user data).
   */
  desktopSessionsRoot: string;
  projectDirName: string;
  projectDirPath: string;
  realProjectPath: string;
  sessionAaaPath: string;
  sessionBbbPath: string;
  sessionCccPath: string;
  memoryTopic1Path: string;
  subagentSub1MetaPath: string;
  subagentSub1TranscriptPath: string;
  overflowFilePath: string;
  /** (CR-CORE-05) session-bbb's file-history backups: authPy backed up twice (v1, v2 — kept), README once. */
  fileHistoryAuthPyBackupPath: string;
  fileHistoryAuthPyBackupName: string;
  fileHistoryReadmeBackupPath: string;
  fileHistoryReadmeBackupName: string;
}

export function buildFixture(): Fixture {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-fixture-"));
  const projectsRoot = path.join(tmpRoot, "projects");
  const fileHistoryRoot = path.join(tmpRoot, "file-history");
  const desktopSessionsRoot = path.join(tmpRoot, "no-desktop-sessions");
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
    }),
    // (CR-CORE-05) A no-op snapshot line (empty trackedFileBackups) — must not contribute to
    // fileCount; this session should still show fileCount: 0.
    line({
      type: "file-history-snapshot",
      messageId: "aaa-snap1",
      snapshot: { messageId: "aaa-snap1", trackedFileBackups: {}, timestamp: "2026-06-01T10:01:30.000Z" },
      isSnapshotUpdate: true
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

  // On real disk, memory/*.md lives under the sanitized project dir (see
  // REQUIREMENTS/knowledge/CLAUDE_SESSION_FORMAT.md), which is also where a session's Write/Edit
  // tool_use targets it — so this is the path a real memory-touch record would carry.
  const memoryTopic1Path = path.join(projectDirPath, "memory", "topic1.md");

  // (CR-CORE-05) file-history-snapshot backups for session-bbb: "backend\tests\test_auth.py" is
  // backed up twice (v1, then v2 — highest version kept, backupFileName updated to v2's), and
  // "README.md" once — expect a merged fileCount of 2 unique paths.
  const fileHistoryAuthPyBackupNameV1 = "0087446fcc94a7fb@v1";
  const fileHistoryAuthPyBackupName = "0087446fcc94a7fb@v2";
  const fileHistoryReadmeBackupName = "a1b2c3d4e5f6a7b8@v1";
  const fileHistoryAuthPyBackupPath = path.join(fileHistoryRoot, "session-bbb", fileHistoryAuthPyBackupName);
  const fileHistoryReadmeBackupPath = path.join(fileHistoryRoot, "session-bbb", fileHistoryReadmeBackupName);

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
              file_path: memoryTopic1Path,
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
    }),
    // (CR-CORE-05) First snapshot: test_auth.py backed up at v1.
    line({
      type: "file-history-snapshot",
      messageId: "bbb-snap1",
      snapshot: {
        messageId: "bbb-snap1",
        trackedFileBackups: {
          "backend\\tests\\test_auth.py": {
            backupFileName: fileHistoryAuthPyBackupNameV1,
            version: 1,
            backupTime: "2026-06-02T09:04:30.000Z"
          }
        },
        timestamp: "2026-06-02T09:04:30.000Z"
      },
      isSnapshotUpdate: true
    }),
    // (CR-CORE-05) Second snapshot: test_auth.py bumped to v2 (must win over v1), plus a new
    // README.md path at v1 — merged unique fileCount should be 2, not 3.
    line({
      type: "file-history-snapshot",
      messageId: "bbb-snap2",
      snapshot: {
        messageId: "bbb-snap2",
        trackedFileBackups: {
          "backend\\tests\\test_auth.py": {
            backupFileName: fileHistoryAuthPyBackupName,
            version: 2,
            backupTime: "2026-06-02T09:05:00.000Z"
          },
          "README.md": {
            backupFileName: fileHistoryReadmeBackupName,
            version: 1,
            backupTime: "2026-06-02T09:05:00.000Z"
          }
        },
        timestamp: "2026-06-02T09:05:00.000Z"
      }
    })
  ]);

  const subagentSub1MetaPath = path.join(subagentsDir, "agent-sub1.meta.json");
  fs.writeFileSync(
    subagentSub1MetaPath,
    JSON.stringify({
      agentType: "general-purpose",
      description: "Refactor helper",
      toolUseId: "toolu_task1",
      agentId: "sub1"
    })
  );

  // Real subagent data always ships a sibling transcript alongside the .meta.json (IX-5.1,
  // confirmed against production Sudoku/Terraza projects) — same shape as a top-level session,
  // with isSidechain/agentId, parseable by the same sessionContent.ts parser.
  const subagentSub1TranscriptPath = path.join(subagentsDir, "agent-sub1.jsonl");
  writeLines(subagentSub1TranscriptPath, [
    line({
      type: "user",
      uuid: "sub1-u1",
      parentUuid: null,
      isSidechain: true,
      agentId: "sub1",
      sessionId: "session-bbb",
      cwd: realProjectPath,
      timestamp: "2026-06-02T09:01:30.000Z",
      message: { role: "user", content: "You are a helper agent. Refactor the auth module." }
    }),
    line({
      type: "assistant",
      uuid: "sub1-a1",
      parentUuid: "sub1-u1",
      isSidechain: true,
      agentId: "sub1",
      sessionId: "session-bbb",
      cwd: realProjectPath,
      timestamp: "2026-06-02T09:01:45.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Done — auth module refactored." }] }
    })
  ]);

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
    memoryTopic1Path,
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

  // --- file-history/ (CR-CORE-05) — real backup content readable at {fileHistoryRoot}/{sessionId}/
  // {backupFileName}, keyed by session UUID (sibling of projects/, per the on-disk investigation).
  const fileHistoryBbbDir = path.join(fileHistoryRoot, "session-bbb");
  fs.mkdirSync(fileHistoryBbbDir, { recursive: true });
  fs.writeFileSync(fileHistoryAuthPyBackupPath, "def test_auth():\n    assert True\n");
  fs.writeFileSync(fileHistoryReadmeBackupPath, "# Fixture Project\n");

  return {
    tmpRoot,
    projectsRoot,
    fileHistoryRoot,
    desktopSessionsRoot,
    projectDirName,
    projectDirPath,
    realProjectPath,
    sessionAaaPath,
    sessionBbbPath,
    sessionCccPath,
    memoryTopic1Path,
    subagentSub1MetaPath,
    subagentSub1TranscriptPath,
    overflowFilePath,
    fileHistoryAuthPyBackupPath,
    fileHistoryAuthPyBackupName,
    fileHistoryReadmeBackupPath,
    fileHistoryReadmeBackupName
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
