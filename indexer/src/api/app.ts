import cors from "cors";
import express, { type Express } from "express";
import type { IndexDb } from "../db/indexDb.js";
import type { AnnotationsDb } from "../db/annotationsDb.js";
import { createProjectsRouter } from "./routes/projects.js";
import { consoleLogger, type Logger } from "../logger.js";
import { defaultOpenFolder, type OpenFolderFn } from "./openFolder.js";
import { ALLOWED_ORIGINS, defaultDesktopSessionsRoot, defaultFileHistoryRoot } from "../config.js";

export interface CreateAppOptions {
  indexDb: IndexDb;
  annotationsDb: AnnotationsDb;
  /** The default {CLAUDE_HOME}/projects root (or a candidate CLAUDE_HOME-like path) to scan. */
  defaultProjectsRoot: string;
  /**
   * (v1.10, CR-CORE-05) The `{CLAUDE_HOME}/file-history` root backups are read from — injectable so
   * tests can point it at a fixture directory instead of a real `~/.claude/file-history`. Defaults
   * to `defaultFileHistoryRoot()` when omitted.
   */
  fileHistoryRoot?: string;
  /**
   * (v1.11, CR-CORE-06) The `{CLAUDE_DESKTOP_HOME}/local-agent-mode-sessions` root Cowork/Chat
   * sessions are discovered from — injectable so tests can point it at a fixture directory instead
   * of a real `%APPDATA%\Claude\local-agent-mode-sessions`. Defaults to
   * `defaultDesktopSessionsRoot()` when omitted.
   */
  desktopSessionsRoot?: string;
  /** Injectable for tests — never shells out in the automated suite. */
  openFolder?: OpenFolderFn;
  logger?: Logger;
  /** Injectable for tests (CR-API-02) — defaults to the golden allowlist in config.ts. */
  allowedOrigins?: string[];
}

/**
 * CORS policy (CR-API-02): explicit origin allowlist, never a wildcard `*`. This API is
 * local-only but side-effecting (`open-folder`, `browse`, and now the CR-UI-08 notes
 * create/update/delete endpoints), so a wildcard would let any website's JavaScript read project
 * paths and trigger those endpoints from a victim's browser. Requests with no `Origin` header
 * (curl, server-to-server, same-origin) are always allowed through — CORS is a browser-enforced,
 * cross-origin-only concept and doesn't apply to them.
 */
function buildCorsMiddleware(allowedOrigins: string[]) {
  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
  });
}

/** Builds the Express app instance without binding a port — tests exercise it directly (supertest). */
export function createApp(options: CreateAppOptions): Express {
  const app = express();
  app.use(buildCorsMiddleware(options.allowedOrigins ?? ALLOWED_ORIGINS));
  app.use(express.json());

  app.use(
    "/api/projects",
    createProjectsRouter({
      indexDb: options.indexDb,
      annotationsDb: options.annotationsDb,
      defaultProjectsRoot: options.defaultProjectsRoot,
      fileHistoryRoot: options.fileHistoryRoot ?? defaultFileHistoryRoot(),
      desktopSessionsRoot: options.desktopSessionsRoot ?? defaultDesktopSessionsRoot(),
      openFolder: options.openFolder ?? defaultOpenFolder,
      logger: options.logger ?? consoleLogger
    })
  );

  return app;
}
