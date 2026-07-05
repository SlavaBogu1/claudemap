import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Builds a fixture `%APPDATA%\Claude\local-agent-mode-sessions`-like tree (CR-CORE-06) in a fresh
 * temp dir, mirroring the real on-disk structure confirmed by the IX-8.5 investigation:
 *   {root}/{orgId}/{projectId}/
 *     spaces.json                     — spaceId -> name lookup for Cowork grouping
 *     local_<sessionId>.json          — session metadata (spaceId present = Cowork, absent = Chat)
 *     local_<sessionId>/audit.jsonl   — the session's own conversation log
 *     rpm/, .project-cache/           — out-of-scope dirs confirmed unrelated to session content
 *   {root}/skills-plugin/             — out-of-scope dir at the root level (plugin bundles)
 *
 * Sessions:
 *   sessCoworkA1, sessCoworkA2 — both spaceId "space-a" ("EW market") -> Cowork, grouped together
 *   sessCoworkB1               — spaceId "space-b" ("Vendor Intelligence") -> Cowork, its own group
 *   sessChat1                  — no spaceId -> Chat, its own ungrouped pseudo-project
 * Each audit.jsonl has 2 top-level user/assistant turns plus one `system` entry (no Claude Code
 * equivalent, excluded from counts) and, for sessCoworkA1 only, one nested sub-conversation turn
 * (`parent_tool_use_id` set) that must also be excluded from the top-level message count.
 */
export interface DesktopFixture {
  tmpRoot: string;
  desktopSessionsRoot: string;
  orgId: string;
  projectId: string;
  projectDirPath: string;
  spaceAId: string;
  spaceBId: string;
}

export function buildDesktopFixture(): DesktopFixture {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "indexer-desktop-fixture-"));
  const desktopSessionsRoot = path.join(tmpRoot, "local-agent-mode-sessions");
  const orgId = "org-1111";
  const projectId = "proj-2222";
  const projectDirPath = path.join(desktopSessionsRoot, orgId, projectId);
  fs.mkdirSync(projectDirPath, { recursive: true });

  const spaceAId = "space-a";
  const spaceBId = "space-b";

  fs.writeFileSync(
    path.join(projectDirPath, "spaces.json"),
    JSON.stringify({
      spaces: [
        { id: spaceAId, name: "EW market", folders: [], projects: [], links: [], instructions: "", createdAt: 1, updatedAt: 1 },
        { id: spaceBId, name: "Vendor Intelligence", folders: [], projects: [], links: [], instructions: "", createdAt: 1, updatedAt: 1 }
      ]
    })
  );

  writeDesktopSession(projectDirPath, {
    sessionId: "local_sess-cowork-a1",
    title: "Cowork task A1",
    spaceId: spaceAId,
    createdAt: Date.UTC(2026, 5, 20, 9, 0, 0),
    lastActivityAt: Date.UTC(2026, 5, 20, 9, 30, 0),
    auditLines: [
      systemInitLine("local_sess-cowork-a1"),
      userLine("local_sess-cowork-a1", "u1", "2026-06-20T09:00:10.000Z"),
      assistantLine("local_sess-cowork-a1", "a1", "2026-06-20T09:00:20.000Z"),
      // A nested sub-conversation turn (inlined, unlike Claude Code's separate subagent file) —
      // must be excluded from the top-level message count.
      userLine("local_sess-cowork-a1", "sub-u1", "2026-06-20T09:00:25.000Z", "toolu_sub_1")
    ]
  });

  writeDesktopSession(projectDirPath, {
    sessionId: "local_sess-cowork-a2",
    title: "Cowork task A2",
    spaceId: spaceAId,
    createdAt: Date.UTC(2026, 5, 21, 9, 0, 0),
    lastActivityAt: Date.UTC(2026, 5, 21, 9, 30, 0),
    auditLines: [
      userLine("local_sess-cowork-a2", "u1", "2026-06-21T09:00:10.000Z"),
      assistantLine("local_sess-cowork-a2", "a1", "2026-06-21T09:00:20.000Z")
    ]
  });

  writeDesktopSession(projectDirPath, {
    sessionId: "local_sess-cowork-b1",
    title: "Vendor task B1",
    spaceId: spaceBId,
    createdAt: Date.UTC(2026, 5, 22, 9, 0, 0),
    lastActivityAt: Date.UTC(2026, 5, 22, 9, 30, 0),
    auditLines: [
      userLine("local_sess-cowork-b1", "u1", "2026-06-22T09:00:10.000Z"),
      assistantLine("local_sess-cowork-b1", "a1", "2026-06-22T09:00:20.000Z")
    ]
  });

  writeDesktopSession(projectDirPath, {
    sessionId: "local_sess-chat-1",
    title: "Write Team Experience Summary",
    spaceId: null,
    createdAt: Date.UTC(2026, 5, 23, 9, 0, 0),
    lastActivityAt: Date.UTC(2026, 5, 23, 9, 30, 0),
    auditLines: [
      userLine("local_sess-chat-1", "u1", "2026-06-23T09:00:10.000Z"),
      assistantLine("local_sess-chat-1", "a1", "2026-06-23T09:00:20.000Z")
    ]
  });

  // --- out-of-scope dirs (IX-8.5: confirmed unrelated to session content) ---------------------
  const rpmDir = path.join(projectDirPath, "rpm", "plugin_abc");
  fs.mkdirSync(rpmDir, { recursive: true });
  fs.writeFileSync(path.join(rpmDir, "manifest.json"), JSON.stringify({ name: "some-plugin" }));

  const projectCacheDir = path.join(projectDirPath, ".project-cache", "019effb9");
  fs.mkdirSync(projectCacheDir, { recursive: true });
  fs.writeFileSync(path.join(projectCacheDir, "memory.md"), "# cached memory, not a session\n");

  const skillsPluginDir = path.join(desktopSessionsRoot, "skills-plugin", projectId, orgId, ".claude-plugin");
  fs.mkdirSync(skillsPluginDir, { recursive: true });
  fs.writeFileSync(path.join(skillsPluginDir, "plugin.json"), JSON.stringify({ name: "skills-plugin" }));

  return { tmpRoot, desktopSessionsRoot, orgId, projectId, projectDirPath, spaceAId, spaceBId };
}

export function cleanupDesktopFixture(fixture: DesktopFixture): void {
  fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
}

interface DesktopSessionSpec {
  sessionId: string;
  title: string;
  spaceId: string | null;
  createdAt: number;
  lastActivityAt: number;
  auditLines: string[];
}

function writeDesktopSession(projectDirPath: string, spec: DesktopSessionSpec): void {
  const metaPath = path.join(projectDirPath, `${spec.sessionId}.json`);
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      sessionId: spec.sessionId,
      title: spec.title,
      spaceId: spec.spaceId,
      spaceIdSetBy: spec.spaceId ? "user" : undefined,
      createdAt: spec.createdAt,
      lastActivityAt: spec.lastActivityAt,
      cwd: "C:\\Fixture\\Desktop",
      model: "claude-sonnet-5",
      sessionType: undefined
    })
  );

  const sessionDir = path.join(projectDirPath, spec.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "audit.jsonl"), spec.auditLines.join("\n") + "\n");
}

function systemInitLine(sessionId: string): string {
  return JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    uuid: `${sessionId}-sys-init`,
    _audit_timestamp: "2026-06-20T09:00:00.000Z"
  });
}

function userLine(sessionId: string, uuid: string, auditTimestamp: string, parentToolUseId?: string): string {
  return JSON.stringify({
    type: "user",
    uuid: `${sessionId}-${uuid}`,
    session_id: sessionId,
    parent_tool_use_id: parentToolUseId ?? null,
    message: { role: "user", content: "Fixture user turn." },
    _audit_timestamp: auditTimestamp
  });
}

function assistantLine(sessionId: string, uuid: string, auditTimestamp: string, parentToolUseId?: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `${sessionId}-${uuid}`,
    session_id: sessionId,
    parent_tool_use_id: parentToolUseId ?? null,
    message: { role: "assistant", content: [{ type: "text", text: "Fixture assistant turn." }] },
    _audit_timestamp: auditTimestamp
  });
}
