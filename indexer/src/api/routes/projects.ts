import { Router } from "express";
import type { IndexDb } from "../../db/indexDb.js";
import { getProjectPath, listProjects, listProjectsByRoot, projectExists, listSessions } from "../../db/indexDb.js";
import type { AnnotationsDb } from "../../db/annotationsDb.js";
import { addScanRoot, listScanRoots } from "../../db/annotationsDb.js";
import { resolveProjectsRoot } from "../../discovery/scanRoots.js";
import { rescan } from "../../discovery/rescan.js";
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

  return router;
}
