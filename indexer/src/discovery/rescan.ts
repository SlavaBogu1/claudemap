import fs from "node:fs";
import path from "node:path";
import type { IndexDb } from "../db/indexDb.js";
import {
  getMemoryFileMtime,
  getSessionMtime,
  replaceMemoryTouches,
  replaceOverflows,
  replaceSubagents,
  updateProjectPath,
  upsertMemoryFile,
  upsertProject,
  upsertSession
} from "../db/indexDb.js";
import { parseSessionFile } from "../parsing/sessionParser.js";
import { parseSubagentMeta } from "../parsing/subagentParser.js";
import { parseMemoryFile } from "../parsing/memoryParser.js";
import { consoleLogger, type Logger } from "../logger.js";

export interface RescanOptions {
  db: IndexDb;
  /** Resolved "projects root" directories (default root + any persisted custom roots). */
  projectsRoots: string[];
  logger?: Logger;
  /** Injectable clock, defaults to Date.now — lets tests assert incremental behavior deterministically. */
  now?: () => number;
}

export interface RescanStats {
  projectsScanned: number;
  sessionsParsed: number;
  sessionsSkipped: number;
  memoryFilesParsed: number;
}

/**
 * Incremental, on-demand rescan (D13): walks the given projects roots and re-parses only files
 * whose mtime changed since the last rescan (tracked per-file in index.db). No timer, no watcher —
 * callers trigger this explicitly (e.g. at the top of a GET route, or after a successful browse).
 */
export function rescan(options: RescanOptions): RescanStats {
  const { db, projectsRoots } = options;
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? Date.now;

  const stats: RescanStats = { projectsScanned: 0, sessionsParsed: 0, sessionsSkipped: 0, memoryFilesParsed: 0 };

  for (const root of projectsRoots) {
    let projectDirs: fs.Dirent[];
    try {
      projectDirs = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      logger.warn(`Cannot read projects root ${root}: ${(err as Error).message}`);
      continue;
    }

    for (const dirEntry of projectDirs) {
      if (!dirEntry.isDirectory()) continue;
      const projectId = dirEntry.name;
      const projectDirPath = path.join(root, projectId);

      upsertProject(db, projectId, root, projectDirPath);
      stats.projectsScanned++;

      rescanProjectSessions(db, projectId, projectDirPath, logger, now, stats);
      rescanProjectMemory(db, projectId, projectDirPath, logger, now, stats);
    }
  }

  return stats;
}

function rescanProjectSessions(
  db: IndexDb,
  projectId: string,
  projectDirPath: string,
  logger: Logger,
  now: () => number,
  stats: RescanStats
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDirPath, { withFileTypes: true });
  } catch (err) {
    logger.warn(`Cannot read project directory ${projectDirPath}: ${(err as Error).message}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

    const sessionId = entry.name.slice(0, -".jsonl".length);
    const filePath = path.join(projectDirPath, entry.name);

    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch (err) {
      logger.warn(`Cannot stat session file ${filePath}: ${(err as Error).message}`);
      continue;
    }

    const previousMtime = getSessionMtime(db, filePath);
    if (previousMtime !== null && previousMtime === mtimeMs) {
      stats.sessionsSkipped++;
      continue; // unchanged — incremental rescan skips re-parsing (D13)
    }

    const parsed = parseSessionFile(filePath, sessionId, logger);

    if (parsed.cwd) {
      updateProjectPath(db, projectId, parsed.cwd);
    }

    const subagentsDir = path.join(projectDirPath, sessionId, "subagents");
    const subagentRecords = [];
    if (fs.existsSync(subagentsDir)) {
      let subEntries: fs.Dirent[] = [];
      try {
        subEntries = fs.readdirSync(subagentsDir, { withFileTypes: true });
      } catch (err) {
        logger.warn(`Cannot read subagents directory ${subagentsDir}: ${(err as Error).message}`);
      }
      for (const subEntry of subEntries) {
        if (!subEntry.isFile() || !subEntry.name.endsWith(".meta.json")) continue;
        const metaPath = path.join(subagentsDir, subEntry.name);
        const record = parseSubagentMeta(metaPath, sessionId, logger);
        if (record) {
          // "Agent Path" (CR-UI-15) / IX-5.1 finding: real subagent data always ships a sibling
          // {agentId}.jsonl transcript alongside the .meta.json (confirmed against fixture +
          // production Sudoku/Terraza projects) — prefer that as the richer content source, but
          // fall back to the meta.json's own path so this is never null for a discovered subagent.
          const transcriptPath = metaPath.slice(0, -".meta.json".length) + ".jsonl";
          record.filePath = fs.existsSync(transcriptPath) ? transcriptPath : metaPath;
          subagentRecords.push(record);
        }
      }
    }

    replaceSubagents(db, sessionId, subagentRecords);
    replaceOverflows(db, sessionId, parsed.overflows);
    replaceMemoryTouches(db, sessionId, parsed.memoryTouches);

    upsertSession(db, {
      id: sessionId,
      projectId,
      filePath,
      mtimeMs,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      messageCount: parsed.messageCount,
      gitBranch: parsed.gitBranch,
      slug: parsed.slug,
      preview: parsed.preview,
      touchedMemory: parsed.touchedMemory,
      subagentCount: subagentRecords.length,
      indexedAt: now()
    });

    stats.sessionsParsed++;
  }
}

function rescanProjectMemory(
  db: IndexDb,
  projectId: string,
  projectDirPath: string,
  logger: Logger,
  now: () => number,
  stats: RescanStats
): void {
  const memoryDir = path.join(projectDirPath, "memory");
  if (!fs.existsSync(memoryDir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  } catch (err) {
    logger.warn(`Cannot read memory directory ${memoryDir}: ${(err as Error).message}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(memoryDir, entry.name);

    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch (err) {
      logger.warn(`Cannot stat memory file ${filePath}: ${(err as Error).message}`);
      continue;
    }

    const previousMtime = getMemoryFileMtime(db, filePath);
    if (previousMtime !== null && previousMtime === mtimeMs) continue;

    const record = parseMemoryFile(filePath, projectId);
    upsertMemoryFile(db, record, mtimeMs, now());
    stats.memoryFilesParsed++;
  }
}
