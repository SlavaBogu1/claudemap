// Cross-team golden values live in REQUIREMENTS/SHARED_CONSTANTS.md — mirrored here as the
// Indexer's runtime constants. If SHARED_CONSTANTS.md changes, update this file to match.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOG_LEVEL = 'error';

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
 * (CR-CORE-06, extended CR-CORE-09) Resolve Claude Desktop's own app-data home, OS-aware — a wholly
 * separate data source from `resolveClaudeHome()`'s `~/.claude` (Claude Code CLI). Branches on
 * `os.platform()`: `win32` → `%APPDATA%\Claude` (unchanged); `darwin` → `~/Library/Application
 * Support/Claude`; `linux` → `${XDG_CONFIG_HOME}/Claude` if set, else `~/.config/Claude`; any other
 * platform value falls back to the `linux` convention with a logged warning rather than throwing.
 * `CLAUDE_DESKTOP_HOME` env override still wins on every platform, following the
 * `resolveClaudeHome()` precedent, so it's testable without touching a real app-data path.
 *
 * Caveat: the macOS/Linux branches are inferred from standard Electron app-data conventions, not
 * confirmed against a real Claude Desktop install on those OSes (none available in this
 * environment) — confirm for real once macOS/Linux porting actually starts.
 */
export function resolveClaudeDesktopHome(): string {
  if (process.env.CLAUDE_DESKTOP_HOME) return process.env.CLAUDE_DESKTOP_HOME;

  const platform = os.platform();
  switch (platform) {
    case "win32": {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, "Claude");
    }
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "Claude");
    case "linux":
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Claude");
    default:
      console.warn(
        `resolveClaudeDesktopHome: unrecognized platform '${platform}', falling back to Linux/XDG convention`
      );
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Claude");
  }
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

/**
 * (CR-CORE-10) The Indexer package's own root directory, derived from this source file's own
 * location rather than `process.cwd()` — this file lives at `{packageRoot}/src/config.ts` at
 * source time and `{packageRoot}/dist/config.js` once built, so walking one directory up from
 * `import.meta.url` reaches `{packageRoot}` either way. Using `process.cwd()`-relative paths broke
 * portability (CR-CORE-10): the database ended up under whatever directory the process happened to
 * be *started* from (e.g. the workspace root via `npm run start`, or a completely different
 * directory on another machine), not a fixed location — so a fresh cache appeared to replace real
 * indexed data instead of the same `indexer/data/index.db` being found and reused.
 */
function getIndexerRoot(): string {
  const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(thisFileDir, "..");
}

export const INDEX_DB_PATH = path.join(getIndexerRoot(), "data", "index.db");
export const ANNOTATIONS_DB_PATH = path.join(getIndexerRoot(), "data", "annotations.db");
