import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";
import type { SubagentRecord } from "../types.js";

/**
 * Parse a single {session-uuid}/subagents/agent-*.meta.json file.
 * The join keys back to the parent session are toolUseId and/or agentId (both optional per the
 * observed real-data shape — record whichever is present).
 */
export function parseSubagentMeta(
  metaFilePath: string,
  sessionId: string,
  logger: Logger
): SubagentRecord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(metaFilePath, "utf-8");
  } catch (err) {
    logger.warn(`Could not read subagent meta file ${metaFilePath}: ${(err as Error).message}`);
    return null;
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    logger.warn(`Malformed subagent meta.json skipped: ${metaFilePath}`);
    return null;
  }

  const base = path.basename(metaFilePath, ".meta.json"); // "agent-{agentId}"
  const agentIdFromName = base.startsWith("agent-") ? base.slice("agent-".length) : base;

  return {
    agentId: json.agentId ?? agentIdFromName,
    sessionId,
    agentType: json.agentType ?? null,
    description: json.description ?? null,
    toolUseId: json.toolUseId ?? null
  };
}
