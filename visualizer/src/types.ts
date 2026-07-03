// Types mirroring the Indexer's documented API contract.
// See _API_CONTRACT/CONTRACT.md (golden copy). Do not invent fields the API doesn't provide.

export interface Project {
  id: string;
  path: string;
  sessionCount: number;
  lastActiveAt: string;
}

export interface Session {
  id: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  gitBranch: string;
  preview: string;
  subagentCount: number;
  touchedMemory: boolean;
  // CR-UI-07 (Sprint 3): documented Indexer v1.4 additions — per-session counts backing the
  // always-visible banner row (Memory/Subagent/Tool). `touchedMemory` above is kept unchanged for
  // backward compatibility (equivalent to `memoryTouchCount > 0`).
  memoryTouchCount: number;
  toolResultCount: number;
}

export type LayoutName = "cose" | "breadthfirst" | "timeline";

export const LAYOUT_OPTIONS: { value: LayoutName; label: string }[] = [
  { value: "cose", label: "Force-directed" },
  { value: "breadthfirst", label: "Hierarchical" },
  { value: "timeline", label: "Timeline" },
];

export const DEFAULT_LAYOUT: LayoutName = "cose";

// CR-UI-10 (Sprint 3): sort order applied to `sessions` before they're mapped to graph nodes —
// orthogonal to `LayoutName` (a user can pick both independently).
export type SortName = "date-desc" | "date-asc" | "agents-desc" | "agents-asc";

export const SORT_OPTIONS: { value: SortName; label: string }[] = [
  { value: "date-desc", label: "Date (newest first)" },
  { value: "date-asc", label: "Date (oldest first)" },
  { value: "agents-desc", label: "Agent count (most first)" },
  { value: "agents-asc", label: "Agent count (fewest first)" },
];

export const DEFAULT_SORT: SortName = "date-desc";

// CR-UI-06 (Sprint 2): documented Indexer v1.3 addition, session-substructure drill-down.
// See _API_CONTRACT/CONTRACT.md GET /api/projects/:id/sessions/:sessionId/detail.
export interface SessionDetail {
  subagents: { agentId: string; agentType: string; description: string }[];
  memoryTouches: { filePath: string; name: string | null }[];
  overflows: { toolUseId: string; filePath: string }[];
}

// CR-UI-08 (Sprint 3): documented Indexer v1.5 additions. See _API_CONTRACT/CONTRACT.md § Notes and
// § content endpoints. `NodeType` is the API's fixed vocabulary for note/content targets — note it
// is "memoryTouch", not "memory" (the Visualizer's internal Cytoscape node `type` value for that
// same item, an unrelated naming layer scoped to `visualizer/src/components/GraphCanvas.tsx`).
export type NodeType = "session" | "memoryTouch" | "subagent" | "tool" | "project";

export interface NoteEntry {
  projectId: string;
  nodeType: NodeType;
  nodeId: string;
  content: string;
  format: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionContentMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface SessionContent {
  messages: SessionContentMessage[];
}

// CR-UI-08 (Sprint 3): the currently-selected graph item, generalized beyond CR-UI-01's
// session-only selection so any node type can drive the Detail panel's new Content tab. `rawId` is
// the bare identifier the notes/content API expects as `nodeId` (see `NodeType` above); `label` is
// a short human-readable header for the Content tab.
export interface SelectedGraphItem {
  nodeType: NodeType;
  rawId: string;
  label: string;
}
