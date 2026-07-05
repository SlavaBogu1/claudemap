import fs from "node:fs";
import type { Logger } from "../logger.js";

/**
 * (CR-CORE-06) One Claude Desktop Cowork/Chat session, parsed from `local_<sessionId>.json` +
 * (a message count from) its sibling `<sessionId>/audit.jsonl`. Kept deliberately minimal per the
 * IX-8.5 on-disk investigation: real `audit.jsonl` data is structurally close to Claude Code's own
 * transcript shape but is NOT 1:1 (extra `system`/`rate_limit_event`/`result` entry types with no
 * Claude Code equivalent; timestamps use `_audit_timestamp` instead of `timestamp`) — only
 * `user`/`assistant` message counting is built this sprint. See
 * `indexer/requirements/SPRINT8_REPORT.md` for the full investigation writeup.
 */
export interface ParsedDesktopSession {
  /** The `local_<uuid>` id — both the `.json` filename (minus extension) and its own `sessionId` field. */
  sessionId: string;
  title: string | null;
  /** Present means Cowork (grouped by the Space's name via `spaces.json`); absent means Chat (D26). */
  spaceId: string | null;
  cwd: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * Parses one `local_<sessionId>.json` metadata file. Tolerant of malformed/partial files — returns
 * null (logged) rather than throwing, same posture as `parseSubagentMeta`.
 */
export function parseDesktopSessionMeta(metaPath: string, logger: Logger): ParsedDesktopSession | null {
  let raw: string;
  try {
    raw = fs.readFileSync(metaPath, "utf-8");
  } catch (err) {
    logger.warn(`Cannot read desktop session meta ${metaPath}: ${(err as Error).message}`);
    return null;
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    logger.warn(`Skipping malformed desktop session meta ${metaPath}: ${(err as Error).message}`);
    return null;
  }

  const sessionId: string | undefined = json.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    logger.warn(`Desktop session meta missing 'sessionId': ${metaPath}`);
    return null;
  }

  return {
    sessionId,
    title: typeof json.title === "string" ? json.title : null,
    spaceId: typeof json.spaceId === "string" && json.spaceId.length > 0 ? json.spaceId : null,
    cwd: typeof json.cwd === "string" ? json.cwd : null,
    model: typeof json.model === "string" ? json.model : null,
    startedAt: epochMsToIso(json.createdAt),
    endedAt: epochMsToIso(json.lastActivityAt)
  };
}

function epochMsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Counts "meaningful" top-level `user`/`assistant` turns in one session's `audit.jsonl` — the IX-8.5
 * investigation's finding that Cowork/Chat sessions only ever have meaningful message counts (no
 * discovered subagent/memory/tool-overflow equivalent worth surfacing this sprint). Entries carrying
 * a non-null `parent_tool_use_id` belong to a nested sub-conversation (this format inlines those in
 * the same file, unlike Claude Code's separate subagent transcript file) and are excluded so the
 * count reflects the session's own top-level conversation, not sub-agent chatter mixed in. Tolerant
 * of malformed/partial lines, same posture as `parseSessionFile`.
 */
export function countDesktopSessionMessages(auditPath: string, logger: Logger): number {
  let raw: string;
  try {
    raw = fs.readFileSync(auditPath, "utf-8");
  } catch (err) {
    logger.warn(`Cannot read audit log ${auditPath}: ${(err as Error).message}`);
    return 0;
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    let entry: any;
    try {
      entry = JSON.parse(lines[i]);
    } catch (err) {
      logger.warn(`Skipping malformed JSONL line ${i + 1} in ${auditPath}: ${(err as Error).message}`);
      continue;
    }

    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.parent_tool_use_id) continue; // nested sub-conversation turn, not top-level

    count++;
  }

  return count;
}

/** (CR-CORE-06) `spaces.json`'s shape — resolves a Cowork session's `spaceId` to a display name. */
export interface ParsedSpace {
  id: string;
  name: string;
}

/**
 * Parses one project directory's `spaces.json` into a `spaceId -> name` lookup. Tolerant — a
 * missing/malformed file yields an empty map (a Cowork session whose Space can't be resolved falls
 * back to its raw `spaceId` as the display name, never an error).
 */
export function parseSpaces(spacesJsonPath: string, logger: Logger): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(spacesJsonPath)) return result;

  let json: any;
  try {
    json = JSON.parse(fs.readFileSync(spacesJsonPath, "utf-8"));
  } catch (err) {
    logger.warn(`Skipping malformed spaces.json ${spacesJsonPath}: ${(err as Error).message}`);
    return result;
  }

  const spaces: ParsedSpace[] = Array.isArray(json?.spaces) ? json.spaces : [];
  for (const space of spaces) {
    if (typeof space?.id === "string" && typeof space?.name === "string") {
      result.set(space.id, space.name);
    }
  }
  return result;
}
