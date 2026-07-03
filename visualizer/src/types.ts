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
}

export type LayoutName = "cose" | "breadthfirst";

export const LAYOUT_OPTIONS: { value: LayoutName; label: string }[] = [
  { value: "cose", label: "Force-directed" },
  { value: "breadthfirst", label: "Hierarchical" },
];

export const DEFAULT_LAYOUT: LayoutName = "cose";
