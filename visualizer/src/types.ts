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
  // CR-UI-28 (Sprint 5): documented Indexer v1.8 addition — true if this session itself or any of
  // its subagent/memory-touch/tool sub-items has a saved note, computed server-side so the note
  // badge can show on a collapsed (never drilled-into) session without an eager per-session
  // `.../detail` fetch.
  hasNotedDescendant: boolean;
}

export type LayoutName = "cose" | "breadthfirst" | "timeline";

export const LAYOUT_OPTIONS: { value: LayoutName; label: string }[] = [
  { value: "cose", label: "Force-directed" },
  { value: "breadthfirst", label: "Hierarchical" },
  { value: "timeline", label: "Timeline" },
];

export const DEFAULT_LAYOUT: LayoutName = "cose";

// CR-UI-10 (Sprint 3): sort order applied to `sessions` before they're mapped to graph nodes —
// orthogonal to `LayoutName` (a user can pick both independently). CR-UI-35 (Sprint 6): extended
// with 3 more desc/asc metric pairs (Memory/Tools/Message count), purely additive.
export type SortName =
  | "date-desc"
  | "date-asc"
  | "agents-desc"
  | "agents-asc"
  | "memory-desc"
  | "memory-asc"
  | "tools-desc"
  | "tools-asc"
  | "messages-desc"
  | "messages-asc";

export const SORT_OPTIONS: { value: SortName; label: string }[] = [
  { value: "date-desc", label: "Date (newest first)" },
  { value: "date-asc", label: "Date (oldest first)" },
  { value: "agents-desc", label: "Agent count (most first)" },
  { value: "agents-asc", label: "Agent count (fewest first)" },
  { value: "memory-desc", label: "Memory count (most first)" },
  { value: "memory-asc", label: "Memory count (fewest first)" },
  { value: "tools-desc", label: "Tools count (most first)" },
  { value: "tools-asc", label: "Tools count (fewest first)" },
  { value: "messages-desc", label: "Message count (most first)" },
  { value: "messages-asc", label: "Message count (fewest first)" },
];

export const DEFAULT_SORT: SortName = "date-desc";

// CR-UI-27 (Sprint 6): client-side session filter applied before sort/layout — orthogonal to both.
export type TimeRangeName = "week" | "month" | "all";

export const TIME_RANGE_OPTIONS: { value: TimeRangeName; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
];

export const DEFAULT_TIME_RANGE: TimeRangeName = "all";

// CR-UI-06 (Sprint 2): documented Indexer v1.3 addition, session-substructure drill-down.
// See _API_CONTRACT/CONTRACT.md GET /api/projects/:id/sessions/:sessionId/detail.
export interface SessionDetail {
  // CR-UI-15 (Sprint 5): `filePath` ("Agent Path", Indexer v1.6) — the subagent's own transcript
  // file when one exists on disk, else its `.meta.json` path as a fallback. Never undefined for a
  // subagent the Indexer discovered at all.
  subagents: { agentId: string; agentType: string; description: string; filePath: string }[];
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

// CR-CORE-03 (Sprint 6): documented Indexer v1.9 addition. See _API_CONTRACT/CONTRACT.md §
// Claude-map notes / GET /api/projects/:id/claude-map-notes. Ingest-written, read-only aggregated
// notes parsed from `[claude-map] <text>` transcript markers — always `nodeType: "session"`, never
// user-editable via the API (no PUT/DELETE), and stored entirely separately from `NoteEntry` above
// (a distinct `claude_map_notes` table that never collides with the user-editable `notes` table).
// Note there is no `format` field here (unlike `NoteEntry`) — this content is always plain
// concatenated marker text, never a user-chosen format.
export interface ClaudeMapNoteEntry {
  projectId: string;
  nodeType: NodeType;
  nodeId: string;
  content: string;
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

// CR-UI-25 (Sprint 5): documented Indexer v1.7 addition. See _API_CONTRACT/CONTRACT.md
// GET /api/projects/:id/content — project-level content, resolved server-side in priority order
// README.md -> CLAUDE.md -> earliest session's first user message -> none.
export type ProjectContentSource = "readme" | "claude-md" | "first-message" | "none";

export interface ProjectContent {
  source: ProjectContentSource;
  content: string | null;
}

// CR-UI-08 (Sprint 3): the currently-selected graph item, generalized beyond CR-UI-01's
// session-only selection so any node type can drive the Detail panel's new Content tab. `rawId` is
// the bare identifier the notes/content API expects as `nodeId` (see `NodeType` above); `label` is
// a short human-readable header for the Content tab.
export interface SelectedGraphItem {
  nodeType: NodeType;
  rawId: string;
  label: string;
  // CR-UI-04 (Sprint 4): the owning session's id — populated for a "session" selection (its own id)
  // and for any session sub-item (subagent/memoryTouch/tool, from that child's `parentSessionId`);
  // omitted for "project" (no session concept). Drives the Detail panel's Info-tab Resume command
  // field (reopen, Sprint 5: no longer a separate Terminal tab), which always
  // needs the *parent session's* id even when a sub-item is selected (there's no per-sub-item resume
  // concept) — a purely client-side Visualizer selection-model field, not part of the Indexer API
  // contract (`_API_CONTRACT/CONTRACT.md`'s `NodeType`/note-key vocabulary is unchanged).
  sessionId?: string;
  // CR-UI-15 (Sprint 5): the real on-disk file path backing a subagent ("Agent Path") or tool
  // ("Tool Path") item — populated by GraphCanvas.tsx from `SessionDetail.subagents[].filePath` /
  // `overflows[].filePath` when that child node is tapped. Distinct from `rawId`, which for these
  // two types is the notes/content API's `nodeId` (`agentId`/`toolUseId`), not a file path. Omitted
  // for "memoryTouch" (its `rawId` already *is* the file path) and for "project"/"session" (no
  // per-item file beyond the project's own folder path).
  filePath?: string;
}
