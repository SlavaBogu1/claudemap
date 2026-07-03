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
}

export interface SubagentRecord {
  agentId: string;
  sessionId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
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

export interface SessionContentMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
}
