import fs from "node:fs";
import path from "node:path";
import type { IndexDb } from "../db/indexDb.js";
import { getSessionMtime, upsertDesktopProject, upsertSession } from "../db/indexDb.js";
import { countDesktopSessionMessages, parseDesktopSessionMeta, parseSpaces } from "../parsing/desktopSessionParser.js";
import { consoleLogger, type Logger } from "../logger.js";

/**
 * (CR-CORE-06) Directory names known to sit alongside real `<orgId>/<projectId>/` session data but
 * hold unrelated content (plugin bundles / caches) — confirmed out of scope by the IX-8.5 on-disk
 * investigation. Skipped at both the root level (`skills-plugin`) and inside a project directory
 * (`rpm`, `.project-cache`) so they're never mistaken for `local_<sessionId>.json` session data.
 */
const OUT_OF_SCOPE_DIR_NAMES = new Set(["skills-plugin", "rpm", ".project-cache", "spaces"]);

export interface DesktopRescanOptions {
  db: IndexDb;
  /** `{CLAUDE_DESKTOP_HOME}/local-agent-mode-sessions` (or a fixture root in tests). */
  desktopSessionsRoot: string;
  logger?: Logger;
  now?: () => number;
}

export interface DesktopRescanStats {
  desktopSessionsScanned: number;
  desktopSessionsParsed: number;
  desktopSessionsSkipped: number;
}

/**
 * Incremental, on-demand rescan (D13, same posture as `rescan()`) of Claude Desktop's Cowork/Chat
 * sessions — a wholly separate data source and directory tree from Claude Code's `~/.claude/projects`
 * (`discovery/rescan.ts`), sharing only the `projects`/`sessions` tables (via `kind`-tagged pseudo-
 * project rows) so the existing per-project session/detail/content routes work unmodified for a
 * Cowork Space or Chat session. Never touches a Code project's own row (disjoint id namespace:
 * `"cowork:<spaceId>"` / `"chat:<sessionId>"` vs. real project directory names) — no regression risk
 * to existing Code discovery.
 */
export function rescanDesktopSessions(options: DesktopRescanOptions): DesktopRescanStats {
  const { db, desktopSessionsRoot } = options;
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? Date.now;

  const stats: DesktopRescanStats = {
    desktopSessionsScanned: 0,
    desktopSessionsParsed: 0,
    desktopSessionsSkipped: 0
  };

  let orgDirs: fs.Dirent[];
  try {
    orgDirs = fs.readdirSync(desktopSessionsRoot, { withFileTypes: true });
  } catch {
    // No Claude Desktop data on this machine (or a test fixture that doesn't create the root) —
    // not an error, just nothing to index.
    return stats;
  }

  for (const orgDir of orgDirs) {
    if (!orgDir.isDirectory() || OUT_OF_SCOPE_DIR_NAMES.has(orgDir.name)) continue;
    const orgPath = path.join(desktopSessionsRoot, orgDir.name);

    let projectDirs: fs.Dirent[];
    try {
      projectDirs = fs.readdirSync(orgPath, { withFileTypes: true });
    } catch (err) {
      logger.warn(`Cannot read desktop org directory ${orgPath}: ${(err as Error).message}`);
      continue;
    }

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory() || OUT_OF_SCOPE_DIR_NAMES.has(projectDir.name)) continue;
      const projectPath = path.join(orgPath, projectDir.name);
      rescanDesktopProjectDir(db, projectPath, logger, now, stats);
    }
  }

  return stats;
}

function rescanDesktopProjectDir(
  db: IndexDb,
  projectPath: string,
  logger: Logger,
  now: () => number,
  stats: DesktopRescanStats
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectPath, { withFileTypes: true });
  } catch (err) {
    logger.warn(`Cannot read desktop project directory ${projectPath}: ${(err as Error).message}`);
    return;
  }

  const spacesById = parseSpaces(path.join(projectPath, "spaces.json"), logger);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("local_") || !entry.name.endsWith(".json")) continue;

    stats.desktopSessionsScanned++;
    const metaPath = path.join(projectPath, entry.name);
    const sessionDirName = entry.name.slice(0, -".json".length);
    const auditPath = path.join(projectPath, sessionDirName, "audit.jsonl");
    // Keyed off audit.jsonl (the larger, more-often-changing file) when present, else the meta file
    // — either way, `getSessionMtime`/`upsertSession` below key incremental re-parsing off this same
    // resolved path (mirrors `rescanProjectSessions`'s per-session `.jsonl` mtime check, D13).
    const contentPath = fs.existsSync(auditPath) ? auditPath : metaPath;

    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(contentPath).mtimeMs;
    } catch (err) {
      logger.warn(`Cannot stat desktop session ${sessionDirName}: ${(err as Error).message}`);
      continue;
    }

    const previousMtime = getSessionMtime(db, contentPath);
    if (previousMtime !== null && previousMtime === mtimeMs) {
      stats.desktopSessionsSkipped++;
      continue;
    }

    const parsed = parseDesktopSessionMeta(metaPath, logger);
    if (!parsed) continue;

    const messageCount = fs.existsSync(auditPath) ? countDesktopSessionMessages(auditPath, logger) : 0;

    // (D26) spaceId present -> Cowork, grouped by that Space's name; absent -> Chat, one
    // pseudo-project per session (mirrors the approved picker mockup's per-session Chat rows).
    const kind: "cowork" | "chat" = parsed.spaceId ? "cowork" : "chat";
    const pseudoProjectId = parsed.spaceId ? `cowork:${parsed.spaceId}` : `chat:${parsed.sessionId}`;
    const displayName = parsed.spaceId
      ? spacesById.get(parsed.spaceId) ?? parsed.spaceId
      : parsed.title ?? parsed.sessionId;

    upsertDesktopProject(db, pseudoProjectId, kind, displayName);

    upsertSession(db, {
      id: parsed.sessionId,
      projectId: pseudoProjectId,
      filePath: contentPath,
      mtimeMs,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      messageCount,
      gitBranch: null,
      slug: null,
      preview: parsed.title,
      touchedMemory: false,
      subagentCount: 0,
      fileCount: 0,
      indexedAt: now()
    });

    stats.desktopSessionsParsed++;
  }
}
