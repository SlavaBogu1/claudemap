import fs from "node:fs";
import type { Logger } from "../logger.js";
import type { SessionContentMessage } from "../types.js";

/**
 * Parse one session `.jsonl` file into its readable user/assistant text turns only (CR-UI-08) —
 * `tool_use`/`tool_result` content blocks are skipped (already represented structurally via
 * `GET .../detail`, CR-UI-06, not re-served here as raw text). A message with no extractable text
 * (e.g. an assistant turn that is only a tool_use) is omitted, not emitted as an empty string.
 *
 * Tolerant of partial/malformed lines, same as `parseSessionFile` — a session file can be
 * mid-write; a bad line is skipped and logged, never a crash.
 */
export function parseSessionContent(filePath: string, logger: Logger): SessionContentMessage[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const messages: SessionContentMessage[] = [];

  for (let i = 0; i < lines.length; i++) {
    let entry: any;
    try {
      entry = JSON.parse(lines[i]);
    } catch (err) {
      logger.warn(`Skipping malformed JSONL line ${i + 1} in ${filePath}: ${(err as Error).message}`);
      continue;
    }

    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.isMeta) continue;

    const text = extractText(entry.message?.content);
    if (text === null) continue;

    messages.push({
      role: entry.type,
      text,
      timestamp: entry.timestamp ?? null
    });
  }

  return messages;
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text);
    if (texts.length === 0) return null;
    const joined = texts.join("\n");
    return joined.trim().length > 0 ? joined : null;
  }
  return null;
}
