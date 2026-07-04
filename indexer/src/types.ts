export interface ProjectEntry {
  id: string;
  path: string;
  sessionCount: number;
  lastActiveAt: string | null;
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

export interface SessionDetail {
  subagents: SessionDetailSubagent[];
  memoryTouches: SessionDetailMemoryTouch[];
  overflows: SessionDetailOverflow[];
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
 * (v1.9, CR-CORE-03) A "claude-map" tagging-skill note: every `[claude-map] <text>` marker message
 * found in one session's transcript, concatenated into a single row keyed
 * `(projectId, "session", sessionId)`. Ingest-time write only — never user-editable via the API
 * (mirrors `NoteRecord`'s shape minus `format`, since this content is always plain concatenated
 * marker text, not a user-chosen format).
 */
export interface ClaudeMapNoteRecord {
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
