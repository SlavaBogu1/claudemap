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
