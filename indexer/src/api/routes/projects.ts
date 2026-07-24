import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { IndexDb } from "../../db/indexDb.js";
import {
  deleteProjectsByRoot,
  fileHistoryBackupExists,
  getProjectPath,
  getSessionDetail,
  getSessionFilePath,
  listProjects,
  listProjectsByKind,
  listProjectsByRoot,
  listSessionDescendantNodeRefs,
  listSessions,
  memoryFileExists,
  projectExists,
  sessionExists,
  subagentFileExists,
  toolResultFileExists
} from "../../db/indexDb.js";
import type { AnnotationsDb } from "../../db/annotationsDb.js";
import {
  addScanRoot,
  deleteNote,
  deleteScanRoot,
  listStickItNotes,
  listNotes,
  listScanRoots,
  upsertNote
} from "../../db/annotationsDb.js";
import { resolveProjectsRoot } from "../../discovery/scanRoots.js";
import { rescan } from "../../discovery/rescan.js";
import { rescanDesktopSessions } from "../../discovery/desktopRescan.js";
import { parseSessionContent } from "../../parsing/sessionContent.js";
import type { Logger } from "../../logger.js";
import type { OpenFolderFn } from "../openFolder.js";

export interface ProjectsRouterOptions {
  indexDb: IndexDb;
  annotationsDb: AnnotationsDb;
  defaultProjectsRoot: string;
  /** (v1.10, CR-CORE-05) `{CLAUDE_HOME}/file-history` root — see `CreateAppOptions.fileHistoryRoot`. */
  fileHistoryRoot: string;
  /** (v1.11, CR-CORE-06) Desktop sessions root — see `CreateAppOptions.desktopSessionsRoot`. */
  desktopSessionsRoot: string;
  openFolder: OpenFolderFn;
  logger: Logger;
}

/** Resolve the default root + every persisted custom root (D20) to valid, currently-scannable roots. */
function resolveAllKnownRoots(options: ProjectsRouterOptions): string[] {
  const roots: string[] = [];

  const resolvedDefault = resolveProjectsRoot(options.defaultProjectsRoot);
  if (resolvedDefault) roots.push(resolvedDefault);

  for (const browsedPath of listScanRoots(options.annotationsDb)) {
    const resolved = resolveProjectsRoot(browsedPath);
    if (resolved) {
      roots.push(resolved);
    } else {
      options.logger.warn(`Persisted scan root no longer resolves to valid session data: ${browsedPath}`);
    }
  }

  return roots;
}

/**
 * (v1.8, CR-UI-28) Enriches `listSessions`' output with `hasNotedDescendant` — true if the session
 * itself, or any of its subagent/memory-touch/tool sub-items, has a saved note. Computed in
 * application code by cross-referencing index.db's per-session sub-item refs against
 * annotations.db's notes list — never a SQL-level join across the two separate SQLite files (D16).
 */
function withHasNotedDescendant(indexDb: IndexDb, annotationsDb: AnnotationsDb, projectId: string) {
  const sessions = listSessions(indexDb, projectId);
  const notedKeys = new Set(listNotes(annotationsDb, projectId).map((n) => `${n.nodeType}:${n.nodeId}`));

  const notedSessionIds = new Set<string>();
  for (const ref of listSessionDescendantNodeRefs(indexDb, projectId)) {
    if (notedKeys.has(`${ref.nodeType}:${ref.nodeId}`)) {
      notedSessionIds.add(ref.sessionId);
    }
  }

  return sessions.map((s) => ({
    ...s,
    hasNotedDescendant: notedKeys.has(`session:${s.id}`) || notedSessionIds.has(s.id)
  }));
}

export function createProjectsRouter(options: ProjectsRouterOptions): Router {
  const router = Router();
  const { indexDb, logger } = options;

  /**
   * Every GET (and the mutating POST/PUT/DELETE routes below) triggers this incremental rescan
   * first (D13). Passing `annotationsDb` lets the rescan persist/replace each re-parsed session's
   * `stick_it_notes` row (CR-CORE-03) alongside the existing index.db bookkeeping.
   */
  function doRescan(projectsRoots: string[] = resolveAllKnownRoots(options)): void {
    rescan({
      db: indexDb,
      projectsRoots,
      annotationsDb: options.annotationsDb,
      fileHistoryRoot: options.fileHistoryRoot,
      logger
    });
    // (v1.11, CR-CORE-06) A separate data source/tree from Code's projectsRoots above — always
    // rescanned in full (no persisted-root variant like Code's browse feature), same on-demand
    // incremental-by-mtime posture (D13). A missing root (no Claude Desktop on this machine, or a
    // fixture that doesn't create it) is a no-op, not an error.
    rescanDesktopSessions({ db: indexDb, desktopSessionsRoot: options.desktopSessionsRoot, logger });
  }

  router.get("/", (_req, res) => {
    doRescan();
    res.json(listProjects(indexDb));
  });

  // (v1.11, CR-CORE-06) Code/Cowork/Chat picker grouping — the data source for the approved
  // grouped-dropdown mockup (REQUIREMENTS/BACKLOG.md's CR-CORE-06 entry). Registered as a static
  // path on this router (mounted at /api/projects) — never confused with the `:id` routes below
  // since none of them match a bare "/project-groups" segment.
  router.get("/project-groups", (_req, res) => {
    doRescan();
    const code = listProjects(indexDb).map((p) => ({
      id: p.id,
      name: p.path,
      sessionCount: p.sessionCount
    }));
    res.json({
      code,
      cowork: listProjectsByKind(indexDb, "cowork"),
      chat: listProjectsByKind(indexDb, "chat")
    });
  });

  router.get("/:id/sessions", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    res.json(withHasNotedDescendant(indexDb, options.annotationsDb, id));
  });

  router.get("/:id/sessions/:sessionId/detail", (req, res) => {
    doRescan();
    const { id, sessionId } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    if (!sessionExists(indexDb, id, sessionId)) {
      res.status(404).json({ error: `Unknown session id: ${sessionId}` });
      return;
    }
    res.json(getSessionDetail(indexDb, sessionId));
  });

  router.post("/browse", (req, res) => {
    const browsedPath = req.body?.path;
    if (typeof browsedPath !== "string" || browsedPath.trim().length === 0) {
      res.status(400).json({ error: "Request body must include a non-empty string 'path'." });
      return;
    }

    const resolvedRoot = resolveProjectsRoot(browsedPath);
    if (!resolvedRoot) {
      res.status(400).json({
        error: `No valid Claude Code session data found at '${browsedPath}' (checked the path itself and a 'projects' subfolder).`
      });
      return;
    }

    addScanRoot(options.annotationsDb, browsedPath);
    doRescan([resolvedRoot]);
    res.json(listProjectsByRoot(indexDb, resolvedRoot));
  });

  // (v1.13, CR-CORE-08) Removes a previously-added custom scan root. Unlike POST /browse, this
  // does not validate that browsedPath still resolves to real session data on disk — that's
  // exactly the "gone stale" case this endpoint exists to clean up (a root that stopped resolving
  // could never be removed before this, since resolveProjectsRoot would reject it). Removing a
  // path that was never persisted (or already removed) is a clean no-op, not an error, matching
  // deleteScanRoot's own no-op-on-miss semantics.
  //
  // Beyond removing the annotations.db row, this also deletes any index.db project rows that were
  // scanned under this root (deleteProjectsByRoot) — CR-CORE-04's per-file pruning only prunes
  // sessions/memory-files *within* a root still being actively scanned, so without this step a
  // removed root's projects would otherwise linger in `GET /api/projects` forever, never pruned by
  // any rescan (the root simply stops being walked at all). Checked against both string forms a
  // resolved root can take relative to the persisted browsedPath (itself, or its `projects/`
  // subfolder) so this still works even when the path no longer resolves on disk at all.
  router.delete("/browse", (req, res) => {
    const browsedPath = req.body?.path;
    if (typeof browsedPath !== "string" || browsedPath.trim().length === 0) {
      res.status(400).json({ error: "Request body must include a non-empty string 'path'." });
      return;
    }

    deleteScanRoot(options.annotationsDb, browsedPath);
    deleteProjectsByRoot(indexDb, browsedPath);
    deleteProjectsByRoot(indexDb, path.join(browsedPath, "projects"));
    doRescan();
    res.json({ ok: true });
  });

  router.post("/:id/open-folder", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    const targetPath = getProjectPath(indexDb, id)!;
    options.openFolder(targetPath);
    res.json({ ok: true });
  });

  router.get("/:id/sessions/:sessionId/content", (req, res) => {
    doRescan();
    const { id, sessionId } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    if (!sessionExists(indexDb, id, sessionId)) {
      res.status(404).json({ error: `Unknown session id: ${sessionId}` });
      return;
    }
    const filePath = getSessionFilePath(indexDb, sessionId)!;
    const messages = parseSessionContent(filePath, logger);
    res.json({ messages });
  });

  router.get("/:id/memory-content", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const filePath = req.query.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      res.status(400).json({ error: "Request query must include a non-empty string 'path'." });
      return;
    }

    // Security requirement (CR-UI-08): never read an arbitrary filesystem path from a query
    // parameter — only a path already known to index.db as an indexed memory file for this
    // project is allowed to be read.
    if (!memoryFileExists(indexDb, id, filePath)) {
      res.status(400).json({
        error: `'${filePath}' is not a known memory file for project '${id}'.`
      });
      return;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      res.json({ content });
    } catch (err) {
      res.status(404).json({ error: `Memory file no longer exists on disk: '${filePath}'.` });
      logger.warn(`memory-content: indexed path unreadable: ${filePath}: ${(err as Error).message}`);
    }
  });

  // (v1.6, CR-UI-15) Subagent content — reuses sessionContent.ts's message-extraction parser
  // against the subagent's own transcript (IX-5.1: real subagent data always has one); falls back
  // to rendering the .meta.json's `description` field as a single synthetic message for the rare
  // case a subagent record's file_path resolved to its meta.json instead (no separate transcript
  // found on disk at index time) — same response shape either way.
  router.get("/:id/agent-content", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const filePath = req.query.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      res.status(400).json({ error: "Request query must include a non-empty string 'path'." });
      return;
    }

    // Security requirement (CR-UI-15, same pattern as memory-content): never read an arbitrary
    // filesystem path from a query parameter — only a path already known to index.db as a
    // subagent's file for this project is allowed to be read.
    if (!subagentFileExists(indexDb, id, filePath)) {
      res.status(400).json({
        error: `'${filePath}' is not a known subagent file for project '${id}'.`
      });
      return;
    }

    try {
      if (filePath.toLowerCase().endsWith(".meta.json")) {
        const raw = fs.readFileSync(filePath, "utf-8");
        let json: any = {};
        try {
          json = JSON.parse(raw);
        } catch (err) {
          logger.warn(`agent-content: malformed meta.json at ${filePath}: ${(err as Error).message}`);
        }
        const messages =
          typeof json.description === "string" && json.description.trim().length > 0
            ? [{ role: "assistant" as const, text: json.description, timestamp: null }]
            : [];
        res.json({ messages });
        return;
      }

      const messages = parseSessionContent(filePath, logger);
      res.json({ messages });
    } catch (err) {
      res.status(404).json({ error: `Agent file no longer exists on disk: '${filePath}'.` });
      logger.warn(`agent-content: indexed path unreadable: ${filePath}: ${(err as Error).message}`);
    }
  });

  // (v1.6, CR-UI-15) Tool-output content — mirrors memory-content's pattern exactly (raw text,
  // path validated against a known tool_result_overflows.file_path for this project first).
  router.get("/:id/tool-content", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const filePath = req.query.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      res.status(400).json({ error: "Request query must include a non-empty string 'path'." });
      return;
    }

    // Security requirement (CR-UI-15, same pattern as memory-content): never read an arbitrary
    // filesystem path from a query parameter — only a path already known to index.db as a
    // tool-result overflow file for this project is allowed to be read.
    if (!toolResultFileExists(indexDb, id, filePath)) {
      res.status(400).json({
        error: `'${filePath}' is not a known tool result file for project '${id}'.`
      });
      return;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      res.json({ content });
    } catch (err) {
      res.status(404).json({ error: `Tool result file no longer exists on disk: '${filePath}'.` });
      logger.warn(`tool-content: indexed path unreadable: ${filePath}: ${(err as Error).message}`);
    }
  });

  // (v1.10, CR-CORE-05; contract revised v1.12 fixing the CR-CORE-05 validation-report Defect 1
  // path-format mismatch) File-history backup content. `path` is the relative two-segment
  // identifier `{sessionId}/{backupFileName}` — the same opaque identifier already exposed by
  // `.../detail`'s `files[]` array (`backupFileName`), NOT a full filesystem path: unlike
  // memory-content/agent-content/tool-content, `.../detail` never hands the client a ready-made
  // absolute path for a file backup, and the file-history root's real on-disk location is
  // server-side-only information the client has no way to construct. The server resolves the
  // absolute path itself from `fileHistoryRoot`. Security requirement (same strength as
  // memory-content/agent-content/tool-content, different mechanics since the input is no longer a
  // full path to range-check): `path` must decompose into exactly two non-empty segments with no
  // `.`/`..` traversal segment, `sessionId` must be a real session for this project, and
  // `backupFileName` must be a known, indexed backup for that session — all validated *before*
  // anything is read from disk.
  router.get("/:id/file-content", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const filePath = req.query.path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      res.status(400).json({ error: "Request query must include a non-empty string 'path'." });
      return;
    }

    const invalidPathError = () =>
      res.status(400).json({
        error: `'${filePath}' is not a known file-history backup for project '${id}'.`
      });

    // Accept either separator so a client can never accidentally pass on the wrong convention;
    // reject any segment that could traverse (`.`/`..`) or an empty segment (leading/trailing/
    // doubled separators).
    const segments = filePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
    const hasTraversal = segments.some((segment) => segment === "." || segment === "..");
    if (hasTraversal || segments.length !== 2) {
      invalidPathError();
      return;
    }

    const [sessionId, backupFileName] = segments;
    if (!sessionExists(indexDb, id, sessionId) || !fileHistoryBackupExists(indexDb, sessionId, backupFileName)) {
      invalidPathError();
      return;
    }

    const resolvedFilePath = path.join(options.fileHistoryRoot, sessionId, backupFileName);
    // Defense-in-depth: confirm the resolved path still sits exactly two segments below
    // fileHistoryRoot (guards against a future change to the segment-validation above regressing
    // this into a traversal bug).
    const relativeToRoot = path.relative(options.fileHistoryRoot, resolvedFilePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      invalidPathError();
      return;
    }

    try {
      const content = fs.readFileSync(resolvedFilePath, "utf-8");
      res.json({ content });
    } catch (err) {
      res.status(404).json({ error: `File backup no longer exists on disk: '${filePath}'.` });
      logger.warn(`file-content: indexed path unreadable: ${resolvedFilePath}: ${(err as Error).message}`);
    }
  });

  // (v1.7, CR-UI-25) Project-level content: README.md -> CLAUDE.md -> earliest session's first
  // user message -> none. README/CLAUDE.md live directly under the project's own resolved root
  // path (getProjectPath), already validated at discovery time — not a user-supplied path, so a
  // plain fs.existsSync/readFileSync is safe here (same reasoning as open-folder's target path).
  router.get("/:id/content", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const projectPath = getProjectPath(indexDb, id)!;

    const readmePath = path.join(projectPath, "README.md");
    if (fs.existsSync(readmePath)) {
      res.json({ source: "readme", content: fs.readFileSync(readmePath, "utf-8") });
      return;
    }

    const claudeMdPath = path.join(projectPath, "CLAUDE.md");
    if (fs.existsSync(claudeMdPath)) {
      res.json({ source: "claude-md", content: fs.readFileSync(claudeMdPath, "utf-8") });
      return;
    }

    const sessions = listSessions(indexDb, id); // already sorted by startedAt ascending
    if (sessions.length > 0) {
      const earliestSessionFilePath = getSessionFilePath(indexDb, sessions[0].id)!;
      const messages = parseSessionContent(earliestSessionFilePath, logger);
      const firstUserMessage = messages.find((m) => m.role === "user");
      if (firstUserMessage) {
        res.json({ source: "first-message", content: firstUserMessage.text });
        return;
      }
    }

    res.json({ source: "none", content: null });
  });

  router.get("/:id/notes", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    res.json(listNotes(options.annotationsDb, id));
  });

  // (v1.9, CR-CORE-03) Read-only — stick-it notes have no user-edit path, so unlike /notes there's
  // no PUT/DELETE here; write access happens only during doRescan()'s ingest pass above.
  router.get("/:id/stick-it-notes", (req, res) => {
    doRescan();
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    res.json(listStickItNotes(options.annotationsDb, id));
  });

  router.put("/:id/notes/:nodeType/:nodeId", (req, res) => {
    doRescan();
    const { id, nodeType, nodeId } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const content = req.body?.content;
    if (typeof content !== "string" || content.length === 0) {
      res.status(400).json({ error: "Request body must include a non-empty string 'content'." });
      return;
    }
    const format = typeof req.body?.format === "string" && req.body.format.length > 0
      ? req.body.format
      : "markdown";

    const note = upsertNote(options.annotationsDb, id, nodeType, nodeId, content, format);
    res.json(note);
  });

  router.delete("/:id/notes/:nodeType/:nodeId", (req, res) => {
    doRescan();
    const { id, nodeType, nodeId } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }

    const existed = deleteNote(options.annotationsDb, id, nodeType, nodeId);
    if (!existed) {
      res.status(404).json({ error: `Unknown note: ${nodeType}/${nodeId} for project '${id}'.` });
      return;
    }
    res.status(204).send();
  });

  return router;
}
