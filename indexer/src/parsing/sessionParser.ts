import fs from "node:fs";
import type { Logger } from "../logger.js";
import type { ToolResultOverflowRecord } from "../types.js";

/** (CR-CORE-05) One tracked file's latest known backup, accumulated across a session's snapshot lines. */
export interface ParsedFileHistoryEntry {
  filePath: string;
  backupFileName: string;
  version: number;
  backupTime: string | null;
}

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
  /**
   * (CR-CORE-03) Every `[claude-map] <text>` marker found in this session's user-turn messages, in
   * transcript order — the caller (discovery/rescan.ts) concatenates these into a single aggregated
   * claude_map_notes row for the session. Empty when the "claude-map" tagging skill was never
   * invoked in this session.
   */
  claudeMapNotes: string[];
  /**
   * (CR-CORE-05) Every unique file path ever backed up in this session, merged across all
   * `file-history-snapshot` lines and keeping the highest `version` per path.
   */
  fileHistory: ParsedFileHistoryEntry[];
}

const COMMAND_TAG_RE = /<\/?(?:local-)?command-[a-z-]+>/gi;
const PERSISTED_OUTPUT_RE = /Full output saved to:\s*([^\r\n]+)/i;
/**
 * (CR-CORE-03) The "claude-map" tagging skill posts a literal `[claude-map] <text>` message into a
 * user turn. Matches once per occurrence within a message's text — `.` doesn't span newlines (no
 * `s` flag), so multiple marker lines within one message are each captured separately.
 */
const CLAUDE_MAP_MARKER_RE = /\[claude-map\]\s*(.+)/gi;

function extractClaudeMapMarkers(text: string | null): string[] {
  if (!text) return [];
  const matches: string[] = [];
  const re = new RegExp(CLAUDE_MAP_MARKER_RE.source, CLAUDE_MAP_MARKER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const captured = m[1].trim();
    if (captured.length > 0) matches.push(captured);
  }
  return matches;
}

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
  const claudeMapNotes: string[] = [];
  // (CR-CORE-05) Keyed by file path; a later snapshot line can bump an existing path's version or
  // introduce a new path — always keep the highest version seen per path across the whole session.
  const fileHistoryByPath = new Map<string, ParsedFileHistoryEntry>();

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

    if (entry.type === "file-history-snapshot") {
      const backups = entry.snapshot?.trackedFileBackups;
      if (backups && typeof backups === "object") {
        for (const [trackedPath, meta] of Object.entries(backups as Record<string, any>)) {
          const version = typeof meta?.version === "number" ? meta.version : 0;
          const backupFileName = typeof meta?.backupFileName === "string" ? meta.backupFileName : null;
          if (!backupFileName) {
            logger.warn(
              `Skipping file-history-snapshot entry with no backupFileName for '${trackedPath}' in ${filePath}`
            );
            continue;
          }
          const existing = fileHistoryByPath.get(trackedPath);
          if (!existing || version > existing.version) {
            fileHistoryByPath.set(trackedPath, {
              filePath: trackedPath,
              backupFileName,
              version,
              backupTime: typeof meta?.backupTime === "string" ? meta.backupTime : null
            });
          }
        }
      }
      continue;
    }

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

    if (entry.type === "user") {
      // (CR-CORE-03 fix) Marker extraction runs against every user-turn entry regardless of
      // `isMeta` — a real slash-command/skill invocation lands its literal `[claude-map] <text>`
      // marker text in a *separate*, `isMeta: true` entry immediately following the (marker-less)
      // command envelope entry. Excluding `isMeta` here (as the code used to) meant a real
      // invocation's marker could never be detected — see BACKLOG.md CR-CORE-03, 2026-07-04
      // re-validation-failed note.
      const userText = extractUserMessageText(content ?? entry.message?.content);

      if (userText !== null) {
        claudeMapNotes.push(...extractClaudeMapMarkers(userText));
      }

      if (!entry.isMeta) {
        // Tool-result overflow detection and first-user-message/preview computation stay gated to
        // non-`isMeta` entries — a slash-command envelope (or the isMeta body that follows it)
        // should never become a session's preview text or be scanned for tool-result overflows.
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

        if (firstUserText === null && userText !== null) {
          const stripped = userText.replace(COMMAND_TAG_RE, "").trim();
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
    overflows,
    claudeMapNotes,
    fileHistory: Array.from(fileHistoryByPath.values())
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
