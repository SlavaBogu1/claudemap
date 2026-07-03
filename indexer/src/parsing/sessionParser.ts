import fs from "node:fs";
import type { Logger } from "../logger.js";
import type { ToolResultOverflowRecord } from "../types.js";

export interface ParsedSession {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  gitBranch: string | null;
  slug: string | null;
  cwd: string | null;
  preview: string | null;
  touchedMemory: boolean;
  memoryTouches: string[];
  overflows: ToolResultOverflowRecord[];
}

const COMMAND_TAG_RE = /<\/?(?:local-)?command-[a-z-]+>/gi;
const PERSISTED_OUTPUT_RE = /Full output saved to:\s*([^\r\n]+)/i;

/**
 * Parse one top-level session `.jsonl` file. Malformed/partial lines are skipped and logged —
 * never thrown — because Claude Code can be actively appending to the file mid-write.
 */
export function parseSessionFile(filePath: string, sessionId: string, logger: Logger): ParsedSession {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let messageCount = 0;
  let gitBranch: string | null = null;
  let slug: string | null = null;
  let cwd: string | null = null;
  let touchedMemory = false;
  const memoryTouches = new Set<string>();
  const overflows: ToolResultOverflowRecord[] = [];

  let firstUserText: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let entry: any;
    try {
      entry = JSON.parse(lines[i]);
    } catch (err) {
      logger.warn(
        `Skipping malformed JSONL line ${i + 1} in ${filePath}: ${(err as Error).message}`
      );
      continue;
    }

    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.gitBranch) gitBranch = entry.gitBranch;
    if (entry.slug && !slug) slug = entry.slug;

    const isMessage = entry.type === "user" || entry.type === "assistant";
    if (!isMessage) continue;

    messageCount++;
    if (startedAt === null && entry.timestamp) startedAt = entry.timestamp;
    if (entry.timestamp) endedAt = entry.timestamp;

    const content = entry.message?.content;

    if (entry.type === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "tool_use" && (block.name === "Write" || block.name === "Edit")) {
          const targetPath: string | undefined = block.input?.file_path ?? block.input?.path;
          if (targetPath && /[\\/]memory[\\/]/i.test(targetPath)) {
            touchedMemory = true;
            memoryTouches.add(targetPath);
          }
        }
      }
    }

    if (entry.type === "user" && !entry.isMeta) {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result") {
            const text = extractToolResultText(block.content);
            const match = text?.match(PERSISTED_OUTPUT_RE);
            if (match) {
              overflows.push({
                sessionId,
                toolUseId: block.tool_use_id ?? block.toolUseId ?? null,
                filePath: match[1].trim()
              });
            }
          }
        }
      }

      if (firstUserText === null) {
        const candidate = extractUserMessageText(content ?? entry.message?.content);
        if (candidate !== null) {
          const stripped = candidate.replace(COMMAND_TAG_RE, "").trim();
          if (stripped.length > 0) firstUserText = stripped;
        }
      }
    }
  }

  const preview = buildPreview(slug, firstUserText);

  return {
    sessionId,
    startedAt,
    endedAt,
    messageCount,
    gitBranch,
    slug,
    cwd,
    preview,
    touchedMemory,
    memoryTouches: Array.from(memoryTouches),
    overflows
  };
}

function extractUserMessageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text);
    if (texts.length === 0) return null;
    return texts.join(" ");
  }
  return null;
}

function extractToolResultText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b: any) => typeof b?.text === "string")
      .map((b: any) => b.text);
    if (texts.length > 0) return texts.join(" ");
  }
  return null;
}

function buildPreview(slug: string | null, firstUserText: string | null): string | null {
  const source = slug ?? firstUserText;
  if (!source) return null;
  return source.length > 200 ? `${source.slice(0, 200)}…` : source;
}
