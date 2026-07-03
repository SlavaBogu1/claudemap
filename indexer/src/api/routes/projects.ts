import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { IndexDb } from "../../db/indexDb.js";
import {
  getProjectPath,
  getSessionDetail,
  getSessionFilePath,
  listProjects,
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
import { addScanRoot, deleteNote, listNotes, listScanRoots, upsertNote } from "../../db/annotationsDb.js";
import { resolveProjectsRoot } from "../../discovery/scanRoots.js";
import { rescan } from "../../discovery/rescan.js";
import { parseSessionContent } from "../../parsing/sessionContent.js";
import type { Logger } from "../../logger.js";
import type { OpenFolderFn } from "../openFolder.js";

export interface ProjectsRouterOptions {
  indexDb: IndexDb;
  annotationsDb: AnnotationsDb;
  defaultProjectsRoot: string;
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

  router.get("/", (_req, res) => {
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
    res.json(listProjects(indexDb));
  });

  router.get("/:id/sessions", (req, res) => {
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    res.json(withHasNotedDescendant(indexDb, options.annotationsDb, id));
  });

  router.get("/:id/sessions/:sessionId/detail", (req, res) => {
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: [resolvedRoot], logger });
    res.json(listProjectsByRoot(indexDb, resolvedRoot));
  });

  router.post("/:id/open-folder", (req, res) => {
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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

  // (v1.7, CR-UI-25) Project-level content: README.md -> CLAUDE.md -> earliest session's first
  // user message -> none. README/CLAUDE.md live directly under the project's own resolved root
  // path (getProjectPath), already validated at discovery time — not a user-supplied path, so a
  // plain fs.existsSync/readFileSync is safe here (same reasoning as open-folder's target path).
  router.get("/:id/content", (req, res) => {
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
    const { id } = req.params;
    if (!projectExists(indexDb, id)) {
      res.status(404).json({ error: `Unknown project id: ${id}` });
      return;
    }
    res.json(listNotes(options.annotationsDb, id));
  });

  router.put("/:id/notes/:nodeType/:nodeId", (req, res) => {
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
    rescan({ db: indexDb, projectsRoots: resolveAllKnownRoots(options), logger });
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
