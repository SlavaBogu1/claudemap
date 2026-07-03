import fs from "node:fs";
import { Router } from "express";
import type { IndexDb } from "../../db/indexDb.js";
import {
  getProjectPath,
  getSessionDetail,
  getSessionFilePath,
  listProjects,
  listProjectsByRoot,
  listSessions,
  memoryFileExists,
  projectExists,
  sessionExists
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
    res.json(listSessions(indexDb, id));
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
