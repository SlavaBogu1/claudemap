import fs from "node:fs";
import path from "node:path";
import type { IndexDb } from "../db/indexDb.js";
import {
  deleteFileHistoryEntry,
  deleteMemoryFile,
  deleteMemoryTouch,
  deleteOverflow,
  deleteSession,
  deleteSubagent,
  getMemoryFileMtime,
  getSessionMtime,
  listFileHistoryRefsForProject,
  listMemoryFilePathsForProject,
  listMemoryTouchFileRefsForProject,
  listOverflowFileRefsForProject,
  listSessionIdsForProject,
  listSubagentFileRefsForProject,
  replaceFileHistoryEntries,
  replaceMemoryTouches,
  replaceOverflows,
  replaceSubagents,
  updateProjectPath,
  upsertMemoryFile,
  upsertProject,
  upsertSession
} from "../db/indexDb.js";
import type { AnnotationsDb } from "../db/annotationsDb.js";
import { deleteStickItNote, upsertStickItNote } from "../db/annotationsDb.js";
import { parseSessionFile } from "../parsing/sessionParser.js";
import { parseSubagentMeta } from "../parsing/subagentParser.js";
import { parseMemoryFile } from "../parsing/memoryParser.js";
import { consoleLogger, type Logger } from "../logger.js";
import { defaultFileHistoryRoot } from "../config.js";

export interface RescanOptions {
  db: IndexDb;
  /** Resolved "projects root" directories (default root + any persisted custom roots). */
  projectsRoots: string[];
  /**
   * (CR-CORE-03) Optional — when provided, a session that's re-parsed this rescan has its
   * `stick_it_notes` row replaced wholesale from the freshly-parsed marker set (or deleted if that
   * set is now empty). Optional so callers/tests that only care about index.db (D16: the two files
   * are never conflated) aren't forced to open annotations.db just to call rescan().
   */
  annotationsDb?: AnnotationsDb;
  /**
   * (CR-CORE-11) `{CLAUDE_HOME}/file-history` root, used only to check whether a `file_history_entries`
   * row's backup still exists on disk (`{fileHistoryRoot}/{sessionId}/{backupFileName}`). Optional,
   * defaults to `defaultFileHistoryRoot()` — mirrors `annotationsDb`'s optionality so existing
   * index.db-only callers/tests aren't forced to pass it.
   */
  fileHistoryRoot?: string;
  logger?: Logger;
  /** Injectable clock, defaults to Date.now — lets tests assert incremental behavior deterministically. */
  now?: () => number;
}

export interface RescanStats {
  projectsScanned: number;
  sessionsParsed: number;
  sessionsSkipped: number;
  memoryFilesParsed: number;
  /** (CR-CORE-04) Previously-indexed sessions pruned this rescan because their `.jsonl` file is gone. */
  sessionsDeleted: number;
  /** (CR-CORE-04) Previously-indexed memory files pruned this rescan because their `.md` file is gone. */
  memoryFilesDeleted: number;
  /** (CR-CORE-11) Previously-indexed subagent rows pruned because their backing file is gone. */
  subagentsDeleted: number;
  /** (CR-CORE-11) Previously-indexed tool-result-overflow rows pruned because their backing file is gone. */
  overflowsDeleted: number;
  /** (CR-CORE-11) Previously-indexed session-memory-touch rows pruned because their backing file is gone. */
  memoryTouchesDeleted: number;
  /** (CR-CORE-11) Previously-indexed file-history-entry rows pruned because their backup file is gone. */
  fileHistoryEntriesDeleted: number;
}

/**
 * Incremental, on-demand rescan (D13): walks the given projects roots and re-parses only files
 * whose mtime changed since the last rescan (tracked per-file in index.db). No timer, no watcher —
 * callers trigger this explicitly (e.g. at the top of a GET route, or after a successful browse).
 */
export function rescan(options: RescanOptions): RescanStats {
  const { db, projectsRoots, annotationsDb } = options;
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? Date.now;
  const fileHistoryRoot = options.fileHistoryRoot ?? defaultFileHistoryRoot();

  const stats: RescanStats = {
    projectsScanned: 0,
    sessionsParsed: 0,
    sessionsSkipped: 0,
    memoryFilesParsed: 0,
    sessionsDeleted: 0,
    memoryFilesDeleted: 0,
    subagentsDeleted: 0,
    overflowsDeleted: 0,
    memoryTouchesDeleted: 0,
    fileHistoryEntriesDeleted: 0
  };

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

      rescanProjectSessions(db, annotationsDb, projectId, projectDirPath, logger, now, stats);
      rescanProjectMemory(db, projectId, projectDirPath, logger, now, stats);
      pruneOrphanedSessionChildren(db, projectId, fileHistoryRoot, stats);
    }
  }

  return stats;
}

/**
 * (CR-CORE-11) Prunes `subagents` / `tool_result_overflows` / `session_memory_touches` /
 * `file_history_entries` rows whose backing file on disk no longer exists — the same "sessions
 * still returned after their backing file vanished" bug `CR-CORE-04` fixed for whole sessions and
 * memory files, extended to these four sub-item tables.
 *
 * **Deliberately runs unconditionally on every rescan, for every session still on disk** — not just
 * ones re-parsed this round. D13's incremental mtime-skip (`rescanProjectSessions`'s
 * `previousMtime === mtimeMs` check) only tells us the parent `.jsonl` itself is unchanged; it says
 * nothing about a *sibling* file (a subagent transcript, an overflow dump, a file-history backup)
 * being deleted independently. If this pruning only ran inside the "session changed, re-parsing"
 * branch, an orphan under an otherwise-untouched session would never be caught, because the parent
 * session's own mtime never changes just because a sibling file vanished. Cheap: one `fs.existsSync`
 * per already-indexed row, not a directory walk — called once per project, after both the session and
 * memory rescans above (so it reflects any `deleteSession` pruning that already ran this rescan).
 *
 * Only ever deletes index.db rows — `annotations.db` (notes, stick-it notes) is never touched (D16).
 */
function pruneOrphanedSessionChildren(
  db: IndexDb,
  projectId: string,
  fileHistoryRoot: string,
  stats: RescanStats
): void {
  for (const ref of listSubagentFileRefsForProject(db, projectId)) {
    if (!ref.filePath || !fs.existsSync(ref.filePath)) {
      deleteSubagent(db, ref.sessionId, ref.agentId);
      stats.subagentsDeleted++;
    }
  }

  for (const ref of listOverflowFileRefsForProject(db, projectId)) {
    if (!fs.existsSync(ref.filePath)) {
      deleteOverflow(db, ref.rowid);
      stats.overflowsDeleted++;
    }
  }

  for (const ref of listMemoryTouchFileRefsForProject(db, projectId)) {
    if (!fs.existsSync(ref.filePath)) {
      deleteMemoryTouch(db, ref.rowid);
      stats.memoryTouchesDeleted++;
    }
  }

  for (const ref of listFileHistoryRefsForProject(db, projectId)) {
    const backupPath = path.join(fileHistoryRoot, ref.sessionId, ref.backupFileName);
    if (!fs.existsSync(backupPath)) {
      deleteFileHistoryEntry(db, ref.rowid);
      stats.fileHistoryEntriesDeleted++;
    }
  }
}

function rescanProjectSessions(
  db: IndexDb,
  annotationsDb: AnnotationsDb | undefined,
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

  const sessionIdsOnDisk = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

    const sessionId = entry.name.slice(0, -".jsonl".length);
    sessionIdsOnDisk.add(sessionId);
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
    // (CR-CORE-05) One row per unique file path, already deduplicated/highest-version-kept by the parser.
    replaceFileHistoryEntries(
      db,
      sessionId,
      parsed.fileHistory.map((f) => ({ sessionId, ...f }))
    );

    // (CR-CORE-03) Wholesale replace, keyed (projectId, "session", sessionId) — safe because this
    // table has no user-edit path to collide with (unlike notes/CR-UI-08). Only touched when this
    // session was actually re-parsed this rescan (unchanged sessions are skipped above, D13).
    if (annotationsDb) {
      if (parsed.stickItNotes.length > 0) {
        upsertStickItNote(annotationsDb, projectId, "session", sessionId, parsed.stickItNotes.join("\n\n"));
      } else {
        deleteStickItNote(annotationsDb, projectId, "session", sessionId);
      }
    }

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
      fileCount: parsed.fileHistory.length,
      indexedAt: now()
    });

    stats.sessionsParsed++;
  }

  // (CR-CORE-04) Prune any previously-indexed session whose backing `.jsonl` file is no longer on
  // disk. Diffed against the on-disk listing just built above (not re-read), so this only ever
  // deletes index.db rows — annotations.db (notes, stick-it notes) is never touched here (D16):
  // if the file is later restored/renamed, its notes are still there under the same session id.
  for (const indexedSessionId of listSessionIdsForProject(db, projectId)) {
    if (!sessionIdsOnDisk.has(indexedSessionId)) {
      deleteSession(db, indexedSessionId);
      stats.sessionsDeleted++;
    }
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
  const memoryFilePathsOnDisk = new Set<string>();

  if (fs.existsSync(memoryDir)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(memoryDir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`Cannot read memory directory ${memoryDir}: ${(err as Error).message}`);
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(memoryDir, entry.name);
      memoryFilePathsOnDisk.add(filePath);

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
  // Note: a missing `memory/` directory (never existed, or the whole folder was removed) falls
  // through here with an empty `memoryFilePathsOnDisk` — every previously-indexed memory file for
  // this project is then correctly treated as deleted below, same as the per-file removal case.

  // (CR-CORE-04) Prune any previously-indexed memory file whose backing `.md` file is no longer on
  // disk. Only index.db's `memory_files` row is removed — annotations.db is never touched (D16).
  for (const indexedFilePath of listMemoryFilePathsForProject(db, projectId)) {
    if (!memoryFilePathsOnDisk.has(indexedFilePath)) {
      deleteMemoryFile(db, indexedFilePath);
      stats.memoryFilesDeleted++;
    }
  }
}
