// Cross-team golden values live in REQUIREMENTS/SHARED_CONSTANTS.md — mirrored here as the
// Indexer's runtime constants. If SHARED_CONSTANTS.md changes, update this file to match.
import os from "node:os";
import path from "node:path";

/** Resolve the Claude Code home directory ({CLAUDE_HOME}), OS-aware. */
export function resolveClaudeHome(): string {
  if (process.env.CLAUDE_HOME) return process.env.CLAUDE_HOME;
  return path.join(os.homedir(), ".claude");
}

/** Default projects root: {CLAUDE_HOME}/projects */
export function defaultProjectsRoot(): string {
  return path.join(resolveClaudeHome(), "projects");
}

/**
 * Default file-history root: {CLAUDE_HOME}/file-history (CR-CORE-05). Session backups are keyed by
 * session UUID (a sibling of `projects/`, not nested under a project directory) — confirmed against
 * real on-disk data, see `REQUIREMENTS/BACKLOG.md` CR-CORE-05.
 */
export function defaultFileHistoryRoot(): string {
  return path.join(resolveClaudeHome(), "file-history");
}

/**
 * (CR-CORE-06) Resolve Claude Desktop's own app-data home, OS-aware — a wholly separate data source
 * from `resolveClaudeHome()`'s `~/.claude` (Claude Code CLI). Windows-specific (`%APPDATA%\Claude`);
 * env-var-overridable following the `resolveClaudeHome()` precedent so it's testable without
 * touching a real `%APPDATA%` path.
 */
export function resolveClaudeDesktopHome(): string {
  if (process.env.CLAUDE_DESKTOP_HOME) return process.env.CLAUDE_DESKTOP_HOME;
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Claude");
}

/**
 * Default Claude Desktop Cowork/Chat sessions root: {CLAUDE_DESKTOP_HOME}/local-agent-mode-sessions
 * (CR-CORE-06) — confirmed real structure: `<orgId>/<projectId>/local_<sessionId>.json` + a
 * same-named sibling folder holding `.claude`, `audit.jsonl`, `outputs/`, `uploads/`, plus a
 * `spaces.json` for Cowork Space name resolution. See `REQUIREMENTS/BACKLOG.md` CR-CORE-06.
 */
export function defaultDesktopSessionsRoot(): string {
  return path.join(resolveClaudeDesktopHome(), "local-agent-mode-sessions");
}

export const API_PORT = 4317;
export const API_HOST = "127.0.0.1";

/**
 * CORS allowlist (CR-API-02): the exact browser origins permitted to read this API's responses
 * and call its POST endpoints. Explicit allowlist, never a wildcard `*` — a wildcard would let
 * any website's JavaScript read project paths and trigger side-effecting endpoints
 * (`open-folder`, `browse`). Extend this array when a new legitimate Visualizer origin appears
 * (e.g. a future built-static-Visualizer origin) — see `_API_CONTRACT/CONTRACT.md` § CORS Policy.
 */
export const ALLOWED_ORIGINS: string[] = [
  "http://localhost:5173", // Visualizer dev server (Vite default port)
  "http://127.0.0.1:5173"
];

export const INDEX_DB_PATH = path.join("data", "index.db");
export const ANNOTATIONS_DB_PATH = path.join("data", "annotations.db");
