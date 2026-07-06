export interface ProjectEntry {
  id: string;
  path: string;
  sessionCount: number;
  lastActiveAt: string | null;
}

/**
 * (v1.11, CR-CORE-06) One entry in `GET /api/projects/project-groups`'s cowork/chat buckets — `id`
 * is the full pseudo-project id (e.g. `"cowork:<spaceId>"`, `"chat:<sessionId>"`), directly usable
 * as `:id` against the existing per-project routes.
 */
export interface ProjectGroupEntry {
  id: string;
  name: string;
  sessionCount: number;
}

/** (v1.11, CR-CORE-06) `GET /api/projects/project-groups`'s response — the Code/Cowork/Chat picker grouping. */
export interface ProjectGroupsResponse {
  code: ProjectGroupEntry[];
  cowork: ProjectGroupEntry[];
  chat: ProjectGroupEntry[];
}

export interface SessionEntry {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  gitBranch: string | null;
  preview: string | null;
  subagentCount: number;
  touchedMemory: boolean;
  memoryTouchCount: number;
  toolResultCount: number;
  /** (v1.10, CR-CORE-05) Count of unique files backed up during this session (file-history-snapshot). */
  fileCount: number;
  /** (v1.8, CR-UI-28) True if this session or any subagent/memory-touch/tool sub-item has a note. */
  hasNotedDescendant: boolean;
}

export interface SubagentRecord {
  agentId: string;
  sessionId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  /**
   * (v1.6, CR-UI-15) The subagent's own file on disk — its `{session-uuid}/subagents/
   * agent-{agentId}.jsonl` transcript when one exists (confirmed present for real subagent data,
   * IX-5.1), else falls back to its `.meta.json` file so this is never null/placeholder for a
   * subagent that was discovered at all.
   */
  filePath: string | null;
}

export interface ToolResultOverflowRecord {
  sessionId: string;
  toolUseId: string | null;
  filePath: string;
}

/**
 * (v1.10, CR-CORE-05) One tracked file's latest backup for a session — merged from every
 * `file-history-snapshot` line in that session's transcript, keeping the highest `version` per
 * unique `filePath` (sessionParser.ts's accumulator).
 */
export interface FileHistoryRecord {
  sessionId: string;
  filePath: string;
  backupFileName: string;
  version: number;
  backupTime: string | null;
}

export interface MemoryFileRecord {
  projectId: string;
  filePath: string;
  name: string | null;
  description: string | null;
  type: string | null;
}

export interface SessionDetailSubagent {
  agentId: string;
  agentType: string | null;
  description: string | null;
  /** (v1.6, CR-UI-15) "Agent Path" — see `SubagentRecord.filePath`. */
  filePath: string | null;
}

export interface SessionDetailMemoryTouch {
  filePath: string;
  name: string | null;
}

export interface SessionDetailOverflow {
  toolUseId: string | null;
  filePath: string;
}

/** (v1.10, CR-CORE-05) One entry in `SessionDetail.files` — see `FileHistoryRecord`. */
export interface SessionDetailFile {
  filePath: string;
  backupFileName: string;
  version: number;
  backupTime: string | null;
}

export interface SessionDetail {
  subagents: SessionDetailSubagent[];
  memoryTouches: SessionDetailMemoryTouch[];
  overflows: SessionDetailOverflow[];
  /** (v1.10, CR-CORE-05) Files backed up during this session, one row per unique file path. */
  files: SessionDetailFile[];
}

/**
 * The node types a user-authored note (CR-UI-08) can attach to. Fixed vocabulary — the Visualizer
 * passes one of these as `:nodeType` on the notes endpoints.
 */
export type NoteNodeType = "session" | "memoryTouch" | "subagent" | "tool" | "project";

export interface NoteRecord {
  projectId: string;
  nodeType: string;
  nodeId: string;
  content: string;
  format: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * (v1.9, CR-CORE-03) A "stick-it" tagging-skill note: every `[stick-it] <text>` marker message
 * found in one session's transcript, concatenated into a single row keyed
 * `(projectId, "session", sessionId)`. Ingest-time write only — never user-editable via the API
 * (mirrors `NoteRecord`'s shape minus `format`, since this content is always plain concatenated
 * marker text, not a user-chosen format).
 */
export interface StickItNoteRecord {
  projectId: string;
  nodeType: string;
  nodeId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionContentMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
}

/** (v1.7, CR-UI-25) GET /api/projects/:id/content's fixed source enum. */
export type ProjectContentSource = "readme" | "claude-md" | "first-message" | "none";

export interface ProjectContent {
  source: ProjectContentSource;
  content: string | null;
}

/** (v1.6, CR-UI-15) GET /api/projects/:id/agent-content's response — same shape as session content. */
export interface AgentContent {
  messages: SessionContentMessage[];
}
