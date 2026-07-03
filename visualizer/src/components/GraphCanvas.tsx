import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type cytoscape from "cytoscape";
import type { Core, ElementDefinition, LayoutOptions, NodeSingular } from "cytoscape";
import {
  DEFAULT_SORT,
  type LayoutName,
  type NodeType,
  type Project,
  type SelectedGraphItem,
  type Session,
  type SessionDetail,
  type SortName,
} from "../types";
import { fetchSessionDetail } from "../api/client";
import type { ThemeName } from "../lib/preferences";

// CR-UI-05 (Sprint 2): virtual coordinate space for the "timeline" preset layout. Cytoscape's
// preset layout fits these into the real viewport (fit: true), so the absolute numbers here only
// need to be internally consistent, not match real pixel dimensions.
const TIMELINE_WIDTH = 1000;
const TIMELINE_SESSION_Y = 200;
const TIMELINE_Y_JITTER = 22; // per-session vertical nudge when startedAt values collide on x
const TIMELINE_CHILD_Y_OFFSET = 140; // CR-UI-06 child nodes rendered below their session (preset only)
// CR-UI-09: radial-cluster sizing for a session's drill-down children under the timeline preset.
const CHILD_CLUSTER_MIN_RADIUS = 60; // px — keeps 1-2 children clearly separated at any count
const CHILD_CLUSTER_NODE_SPACING = 70; // px — generous vs. the ~56px child node diameter
// CR-UI-16 (Sprint 4): per-type row layout, built on top of CR-UI-09's fix — replaces the single
// mixed radial cluster with three separate rows (Memory, then Subagent, then Tool, top-to-bottom).
const CHILD_ROW_Y_SPACING = 90; // px — vertical gap between successive *present* rows
const CHILD_ROW_NODE_SPACING = 70; // px — horizontal spacing between siblings within a row (mirrors
// CHILD_CLUSTER_NODE_SPACING's generous margin vs. the ~56px child node diameter)
// CR-UI-18 (Sprint 4): small inward nudge so a note badge visually sits ON a node's bottom-right
// corner rather than floating fully outside its shape.
const NOTE_BADGE_INWARD_OFFSET = 5;

function formatSessionLabel(startedAt: string): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return startedAt;
  const datePart = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart}\n${timePart}`;
}

// CR-UI-09: given a parent session's timeline position and the ids of its currently-expanded
// drill-down children (already ordered — subagents, then memory touches, then tool results, per
// buildChildElements' insertion order), returns one evenly-spaced point per child on a circle
// centered below the parent. The radius scales with child count (the standard "N points evenly
// spaced on a circle" formula, `radius = max(minRadius, (n * spacing) / (2 * PI))`) so children
// never overlap regardless of how many there are, with a floor so 1-2 children still land clearly
// separated from the parent rather than collapsing toward its center. Deterministic — the same
// childIds in the same order always produce the same positions, so re-renders don't jitter.
export function computeChildClusterPositions(
  parentPos: { x: number; y: number },
  childIds: string[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const n = childIds.length;
  if (n === 0) return positions;

  const radius = Math.max(CHILD_CLUSTER_MIN_RADIUS, (n * CHILD_CLUSTER_NODE_SPACING) / (2 * Math.PI));
  const centerY = parentPos.y + TIMELINE_CHILD_Y_OFFSET;
  childIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top (12 o'clock), clockwise
    positions[id] = {
      x: parentPos.x + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
  return positions;
}

// CR-UI-16 (Sprint 4, built on CR-UI-09's fix): given a parent session's (live) position and its
// drill-down children pre-grouped into rows — one entry per drill-down type, in the fixed
// Memory/Subagent/Tool top-to-bottom order, each entry's `ids` already that type's full sibling
// list — returns one point per child, laid out as evenly-spaced rows below the parent instead of
// CR-UI-09's single mixed radial cluster. A `ids: []` entry (that type has zero items for this
// session) contributes no row and is skipped entirely — the next non-empty type's row lands
// immediately after the previous one, so rows never leave a gap for an absent type. Within a row,
// siblings are spaced evenly along X, centered under the parent, with a fixed inter-sibling spacing
// (mirrors `computeChildClusterPositions`' "fixed arc-length spacing keeps points from ever
// overlapping regardless of count" principle, adapted from a circle's circumference to a
// straight line's length: `totalWidth = (n - 1) * spacing` grows with the row's count rather than
// the spacing itself shrinking). Deterministic — same input always produces the same output.
export function computeChildRowPositions(
  parentPos: { x: number; y: number },
  rows: { ids: string[] }[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  let rowIndex = 0;
  for (const { ids } of rows) {
    if (ids.length === 0) continue;
    const y = parentPos.y + TIMELINE_CHILD_Y_OFFSET + rowIndex * CHILD_ROW_Y_SPACING;
    const totalWidth = (ids.length - 1) * CHILD_ROW_NODE_SPACING;
    ids.forEach((id, i) => {
      positions[id] = { x: parentPos.x - totalWidth / 2 + i * CHILD_ROW_NODE_SPACING, y };
    });
    rowIndex++;
  }
  return positions;
}

// CR-UI-05: maps each session's startedAt linearly across [0, TIMELINE_WIDTH] (earliest -> left
// edge, latest -> right edge). Sessions that round to the same x get a small y jitter so two
// sessions sharing a timestamp don't perfectly overlap. Project node gets a fixed centered spot.
function computeTimelinePositions(
  project: Project,
  sessions: Session[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {
    [`project:${project.id}`]: { x: TIMELINE_WIDTH / 2, y: 0 },
  };
  if (sessions.length === 0) return positions;

  const times = sessions.map((s) => new Date(s.startedAt).getTime());
  const validTimes = times.filter((t) => !Number.isNaN(t));
  const minT = validTimes.length > 0 ? Math.min(...validTimes) : 0;
  const maxT = validTimes.length > 0 ? Math.max(...validTimes) : 0;
  const span = maxT - minT;

  const occurrencesAtX = new Map<number, number>();
  sessions.forEach((s, i) => {
    const t = times[i];
    const x =
      span === 0 || Number.isNaN(t) ? TIMELINE_WIDTH / 2 : ((t - minT) / span) * TIMELINE_WIDTH;
    const xKey = Math.round(x);
    const occurrence = occurrencesAtX.get(xKey) ?? 0;
    occurrencesAtX.set(xKey, occurrence + 1);
    positions[s.id] = { x, y: TIMELINE_SESSION_Y + occurrence * TIMELINE_Y_JITTER };
  });

  return positions;
}

function layoutOptionsFor(
  name: LayoutName,
  project: Project,
  sessions: Session[],
  sort: SortName,
): LayoutOptions {
  if (name === "breadthfirst") {
    // CR-UI-10: Cytoscape's breadthfirst layout sorts same-depth siblings by node id ascending by
    // default (see cytoscape/src/extensions/layout/breadthfirst.mjs's `sortFn`) — it ignores
    // insertion/array order entirely unless given an explicit `depthSort`. Without this, the chosen
    // sort would silently have no visible effect on Hierarchical mode (the one mode this CR mainly
    // targets), quietly falling back to alphabetical-by-session-id instead.
    const sortedSessions = sortSessions(sessions, sort);
    const rank = new Map<string, number>();
    sortedSessions.forEach((s, i) => rank.set(s.id, i));
    return {
      name: "breadthfirst",
      directed: true,
      padding: 30,
      spacingFactor: 1.2,
      animate: false,
      depthSort: (a: NodeSingular, b: NodeSingular) => {
        const ra = rank.get(a.id());
        const rb = rank.get(b.id());
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return a.id() < b.id() ? -1 : a.id() > b.id() ? 1 : 0;
      },
    } as LayoutOptions;
  }
  if (name === "timeline") {
    const positions = computeTimelinePositions(project, sessions);
    // CR-UI-09: cache of childId -> position, built once per layout call (not once per node) the
    // first time any child node is resolved during this run, from the full sibling group present
    // in Cytoscape at that moment — grouping per parent to avoid O(n^2) rework across many children.
    let childClusterCache: Record<string, { x: number; y: number }> | null = null;

    // CR-UI-09 (reopen, Sprint 4): resolves a session/project node's position for cluster-building
    // purposes from its actual *current* position in the graph — which reflects any drag that
    // happened since the last relayout — rather than `computeTimelinePositions`' output, which is
    // computed purely from `startedAt` and knows nothing about drags. Falls back to the computed
    // timeline position only when the node isn't resolvable in Cytoscape yet (the node itself is
    // being positioned for the first time on a full relayout — see the `positions[id]` branch
    // below, which is the path that actually establishes a session/project node's own position).
    function resolveParentPos(cy: Core, parentId: string): { x: number; y: number } | undefined {
      const parentNode = cy.getElementById(parentId);
      if (parentNode.length > 0) return parentNode.position();
      return positions[parentId];
    }

    return {
      name: "preset",
      fit: true,
      padding: 30,
      animate: false,
      // Session/project nodes use their computed timeline position. CR-UI-06 drill-down child
      // nodes (subagent/memory/tool, CR-UI-14) aren't sessions, so they're arranged below their
      // parent session — CR-UI-16: one row per present type (Memory, Subagent, Tool) rather than
      // CR-UI-09's single mixed radial cluster — returning undefined for anything else leaves it
      // at its current position.
      positions: (node: NodeSingular) => {
        const id = node.id();
        if (positions[id]) return positions[id];
        const parentId = node.data("parentSessionId") as string | undefined;
        if (!parentId) return undefined;
        const parentPos = resolveParentPos(node.cy(), parentId);
        if (!parentPos) return undefined;

        if (!childClusterCache) {
          childClusterCache = {};
          // CR-UI-16: grouped per parent AND per type (fixed Memory/Subagent/Tool row order) —
          // still built once per layout run, grouping the full sibling set present in Cytoscape at
          // that moment, same as CR-UI-09's original per-parent-only grouping.
          const byParent = new Map<string, { memory: string[]; subagent: string[]; tool: string[] }>();
          node.cy().nodes('[parentSessionId]').forEach((childNode: NodeSingular) => {
            const pId = childNode.data("parentSessionId") as string;
            const type = childNode.data("type") as "memory" | "subagent" | "tool";
            const groups = byParent.get(pId) ?? { memory: [], subagent: [], tool: [] };
            groups[type].push(childNode.id());
            byParent.set(pId, groups);
          });
          for (const [pId, groups] of byParent) {
            const pPos = resolveParentPos(node.cy(), pId);
            if (!pPos) continue;
            Object.assign(
              childClusterCache,
              computeChildRowPositions(pPos, [
                { ids: groups.memory },
                { ids: groups.subagent },
                { ids: groups.tool },
              ]),
            );
          }
        }
        return childClusterCache[id];
      },
    } as LayoutOptions;
  }
  return {
    name: "cose",
    padding: 30,
    animate: false,
    // CR-UI-13: seed from current positions rather than fully randomizing on every run, even for
    // the deliberate full-relayout case (switching layouts) — defense in depth alongside the
    // locked-node scoping below.
    randomize: false,
  } as LayoutOptions;
}

// CR-UI-24 (Sprint 5): Cytoscape renders to a JS-driven <canvas>, not real DOM — its stylesheet is
// a plain JS object that never picks up CSS variables or the `prefers-color-scheme` media query
// `index.css` uses for the rest of the app's chrome. So the canvas needs its own light/dark
// palette, mirroring `index.css`'s two palettes conceptually (node fill/border, edge line, plus the
// selection outline color) — selected in `GraphCanvas` below based on the resolved theme, and the
// whole stylesheet rebuilt/reapplied (react-cytoscapejs diffs+patches the `stylesheet` prop, see
// `node_modules/react-cytoscapejs/src/patch.js`) whenever that resolved theme changes.
interface CanvasPalette {
  defaultBg: string;
  defaultText: string;
  defaultBorder: string;
  projectBg: string;
  projectText: string;
  subagentBg: string;
  subagentText: string;
  memoryBg: string;
  memoryText: string;
  toolBg: string;
  toolText: string;
  selectedBorder: string;
  edgeLine: string;
}

const LIGHT_PALETTE: CanvasPalette = {
  defaultBg: "#e5e4e7",
  defaultText: "#08060d",
  defaultBorder: "#6b6375",
  projectBg: "#aa3bff",
  projectText: "#fff",
  subagentBg: "#3b6bff",
  subagentText: "#fff",
  memoryBg: "#f2c14e",
  memoryText: "#08060d",
  toolBg: "#9a97a1",
  toolText: "#08060d",
  selectedBorder: "#aa3bff",
  edgeLine: "#c9c7cf",
};

const DARK_PALETTE: CanvasPalette = {
  defaultBg: "#3a3d47",
  defaultText: "#f3f4f6",
  defaultBorder: "#6b7280",
  projectBg: "#c084fc",
  projectText: "#16171d",
  subagentBg: "#6d8dff",
  subagentText: "#16171d",
  memoryBg: "#f2c14e",
  memoryText: "#16171d",
  toolBg: "#9a97a1",
  toolText: "#16171d",
  selectedBorder: "#c084fc",
  edgeLine: "#565a68",
};

function buildStylesheet(palette: CanvasPalette): cytoscape.StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "font-size": 11,
        color: palette.defaultText,
        "background-color": palette.defaultBg,
        "border-width": 1,
        "border-color": palette.defaultBorder,
        width: 70,
        height: 70,
      },
    },
    {
      selector: 'node[type = "project"]',
      style: {
        "background-color": palette.projectBg,
        color: palette.projectText,
        width: 90,
        height: 90,
        "font-weight": "bold",
      },
    },
    {
      selector: 'node[type = "session"]',
      style: {
        shape: "round-rectangle",
      },
    },
    // CR-UI-06 (Sprint 2, D6-gated): drill-down child node types, each visually distinct (shape +
    // color) from session nodes (rounded rect) and the project node (default ellipse) and from
    // each other, per the approved mockup legend (visualizer/requirements/SPRINT_TASKS.md).
    {
      selector: 'node[type = "subagent"]',
      style: {
        shape: "diamond",
        "background-color": palette.subagentBg,
        color: palette.subagentText,
        width: 56,
        height: 56,
      },
    },
    {
      selector: 'node[type = "memory"]',
      style: {
        shape: "star",
        "background-color": palette.memoryBg,
        color: palette.memoryText,
        width: 56,
        height: 56,
      },
    },
    {
      // CR-UI-14 (Sprint 3): renamed from "overflow" — same data/shape/color, new type identifier
      // and user-facing label/icon (⚙ Tool, in the label text — Cytoscape's built-in shapes don't
      // include a literal gear, consistent with how ★/◆ are emoji-prefixed in their labels).
      selector: 'node[type = "tool"]',
      style: {
        shape: "rectangle",
        "background-color": palette.toolBg,
        color: palette.toolText,
        width: 56,
        height: 56,
      },
    },
    {
      selector: "node.selected",
      style: {
        "border-width": 3,
        "border-color": palette.selectedBorder,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": palette.edgeLine,
        "curve-style": "bezier",
        "target-arrow-shape": "none",
      },
    },
  ];
}

export interface GraphCanvasProps {
  project: Project;
  sessions: Session[];
  layout: LayoutName;
  // CR-UI-10: sort criterion applied to `sessions` before layout — orthogonal to `layout` (most
  // visible in Hierarchical mode, where array order determines left-to-right traversal order).
  sort: SortName;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  // CR-UI-07 (D23): when false, no banner row renders on any session node.
  showBanners: boolean;
  // CR-UI-08: fired for a tap on ANY node type (session, subagent, memory, tool, project) — a
  // superset of `onSelectSession` above (still fired, unchanged, for session taps only) so the
  // Detail panel's new Content tab can work for any selected item type.
  onSelectItem: (item: SelectedGraphItem) => void;
  // CR-UI-08: `${nodeType}:${rawId}` keys of every item with a saved note — drives the 📝 label
  // suffix on graph nodes. Built once per project in App.tsx from `GET .../notes`.
  notedKeys?: Set<string>;
  // CR-UI-24: the user's Light/Dark/System theme preference — resolved to an actual light/dark
  // palette for the Cytoscape stylesheet below ("system" follows the OS preference).
  theme: ThemeName;
}

// CR-UI-10: pure sort step, pulled out for unit testing. A plain `.slice().sort(...)` — no
// Cytoscape API involved, so whichever layout is active simply receives pre-sorted input.
export function sortSessions(sessions: Session[], sort: SortName): Session[] {
  const sorted = sessions.slice();
  switch (sort) {
    case "date-asc":
      sorted.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
      break;
    case "agents-desc":
      sorted.sort((a, b) => b.subagentCount - a.subagentCount);
      break;
    case "agents-asc":
      sorted.sort((a, b) => a.subagentCount - b.subagentCount);
      break;
    case "date-desc":
    default:
      sorted.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      break;
  }
  return sorted;
}

// CR-UI-18 (Sprint 4): the 📝 note indicator moved from an in-label suffix to the `.note-badge-layer`
// corner-badge overlay (see the component below) — `buildGraphElements`/`buildChildElements` below
// no longer take a `notedKeys` param or touch label text for notes at all; `GraphCanvasProps.notedKeys`
// now feeds only the badge overlay's own positioning logic.

// Pure element-builder pulled out of the component so extremes (1 vs 20+ sessions, VZ-1.5) can be
// unit-tested without mounting Cytoscape (which needs a real canvas, unavailable under jsdom).
export function buildGraphElements(
  project: Project,
  sessions: Session[],
  sort: SortName = DEFAULT_SORT,
): ElementDefinition[] {
  const sortedSessions = sortSessions(sessions, sort);
  const projectNode: ElementDefinition = {
    data: {
      id: `project:${project.id}`,
      label: `🎯 ${project.path.split(/[/\\]/).pop() ?? project.id}`,
      type: "project",
      rawId: project.id,
    },
  };
  const sessionNodes: ElementDefinition[] = sortedSessions.map((s) => ({
    data: {
      id: s.id,
      label: formatSessionLabel(s.startedAt),
      type: "session",
      rawId: s.id,
    },
  }));
  const edges: ElementDefinition[] = sortedSessions.map((s) => ({
    data: {
      id: `edge:${project.id}:${s.id}`,
      source: `project:${project.id}`,
      target: s.id,
    },
  }));
  return [projectNode, ...sessionNodes, ...edges];
}

// CR-UI-07 (Sprint 3): the three drill-down child types, now independently toggleable per banner
// (previously an all-or-nothing expand via CR-UI-06's session-body click).
export type DrillDownType = "subagent" | "memory" | "tool";

// CR-UI-06 (Sprint 2): child nodes added below a session node on expand, one per subagent/memory
// touch/tool-result-overflow file, per the approved mockup. Pure + exported so expand-state fan-out
// can be unit-tested without mounting Cytoscape.
// CR-UI-14 (Sprint 3): the third child type is display-renamed "Overflow" -> "Tool" (⚙) — a rename
// only, no new data. `detail.overflows`/`o.filePath`/`o.toolUseId` below are the API contract's
// `SessionDetail.overflows` field, a separate/unrelated naming layer that is NOT renamed.
// CR-UI-07 (Sprint 3): `types`, when given, restricts output to only those drill-down types — the
// per-banner toggle expands one type at a time. Omitted (or `undefined`) includes all three,
// preserving the original CR-UI-06 all-at-once behavior for existing callers/tests.
// CR-UI-08 (Sprint 3): each child's data also carries `rawId` — the bare identifier
// (`agentId`/`filePath`/`toolUseId`) the notes/content API's `nodeId` expects, distinct from this
// function's own composite Cytoscape node id (`${sessionId}:<type>:<rawId>`, needed for uniqueness
// across sessions on the canvas).
// CR-UI-08: maps the Visualizer's internal Cytoscape node `type` value to the notes/content API's
// `NodeType` vocabulary — they differ for one case ("memory" vs "memoryTouch").
export function toApiNodeType(type: DrillDownType): NodeType {
  return type === "memory" ? "memoryTouch" : type;
}

// CR-UI-18 (Sprint 4): same "memory" -> "memoryTouch" mapping as `toApiNodeType` above, generalized
// to every Cytoscape node `type` value (including "project"/"session", which `toApiNodeType`'s
// `DrillDownType` param can't accept) — used by the note-badge overlay below, which (unlike the old
// in-label 📝 suffix) checks `notedKeys` membership for ALL node types, not just drill-down children.
function apiNodeTypeForCyType(cyType: string): NodeType {
  return cyType === "memory" ? "memoryTouch" : (cyType as NodeType);
}

export function buildChildElements(
  sessionId: string,
  detail: SessionDetail,
  types?: Set<DrillDownType>,
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const include = (t: DrillDownType) => !types || types.has(t);

  // CR-UI-15 (Sprint 5): `filePath` carries the real on-disk path backing subagent/tool items
  // ("Agent Path"/"Tool Path") — distinct from `rawId` (the notes/content API's `nodeId`) for these
  // two types. Omitted for memory (its `rawId` already *is* the file path).
  function addChild(id: string, label: string, type: DrillDownType, rawId: string, filePath?: string) {
    elements.push({ data: { id, label, type, parentSessionId: sessionId, rawId, filePath } });
    elements.push({
      data: { id: `edge:${id}`, source: sessionId, target: id },
    });
  }

  if (include("subagent")) {
    detail.subagents.forEach((a) => {
      addChild(`${sessionId}:subagent:${a.agentId}`, `◆ Agent`, "subagent", a.agentId, a.filePath);
    });
  }
  if (include("memory")) {
    // CR-UI-22 (Sprint 4): label simplified to the fixed "★ Memory" text — the filename (formerly
    // `m.name ?? basename(m.filePath)`, with a fallback for the Sprint-2 null-name case, Indexer
    // LEFT JOIN) no longer appears in-label. `m.name`/`m.filePath` are still real API data on
    // `SessionDetail` (untouched) and `m.filePath` is still this child's `rawId` — only the label
    // template dropped them. CR-UI-15's "Memory Path" field reuses `rawId` directly (no separate
    // `filePath` needed here, unlike subagent/tool).
    detail.memoryTouches.forEach((m) => {
      addChild(`${sessionId}:memory:${m.filePath}`, `★ Memory`, "memory", m.filePath);
    });
  }
  if (include("tool")) {
    detail.overflows.forEach((o) => {
      addChild(`${sessionId}:tool:${o.toolUseId}`, `⚙ Tool log`, "tool", o.toolUseId, o.filePath);
    });
  }

  return elements;
}

export function GraphCanvas({
  project,
  sessions,
  layout,
  sort,
  selectedSessionId,
  onSelectSession,
  showBanners,
  onSelectItem,
  notedKeys,
  theme,
}: GraphCanvasProps) {
  const cyRef = useRef<Core | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // CR-UI-24: "system" resolves to the OS's live `prefers-color-scheme` preference — tracked as
  // state (not read once) so the canvas keeps following the OS setting exactly like `index.css`'s
  // media query does for the rest of the app's chrome, even if the OS preference changes while the
  // app is open.
  const [osPrefersDark, setOsPrefersDark] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => setOsPrefersDark(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);
  const resolvedDark = theme === "dark" || (theme === "system" && osPrefersDark);
  // CR-UI-24: rebuilt (new array reference) whenever the resolved theme changes — react-cytoscapejs
  // diffs the `stylesheet` prop and reapplies it to the live `cy` instance, since Cytoscape has no
  // built-in way to pick up a CSS variable change on its own.
  const stylesheet = useMemo(
    () => buildStylesheet(resolvedDark ? DARK_PALETTE : LIGHT_PALETTE),
    [resolvedDark],
  );
  // Test/observability hook only (not part of the approved mockup, D6): reflects the app-level
  // LayoutName Cytoscape most recently finished running, so Playwright can assert layout switches
  // happened via Cytoscape's own state rather than a pixel diff (VZ-1.6 acceptance 2). Tracked via a
  // ref updated on every render (not Cytoscape's own algorithm name) because "timeline" (CR-UI-05)
  // maps to Cytoscape's built-in "preset" algorithm, so the two names aren't interchangeable.
  const [appliedLayout, setAppliedLayout] = useState<LayoutName>(layout);
  const pendingLayoutRef = useRef<LayoutName>(layout);
  pendingLayoutRef.current = layout;

  // CR-UI-07 (Sprint 3): which drill-down TYPES are expanded per session (replaces CR-UI-06's
  // all-or-nothing `expandedSessionIds` — each banner now toggles only its own type), and the
  // fetched detail behind each session (cached across all three types so re-expanding a different
  // type after a collapse doesn't re-fetch). Cleared when the project changes since session ids
  // aren't guaranteed unique across projects.
  const [expandedTypes, setExpandedTypes] = useState<Map<string, Set<DrillDownType>>>(new Map());
  const [sessionDetails, setSessionDetails] = useState<Map<string, SessionDetail>>(new Map());

  useEffect(() => {
    setExpandedTypes(new Map());
    setSessionDetails(new Map());
  }, [project.id]);

  // CR-UI-07: on-screen (rendered, relative to `.graph-canvas-wrapper`) position for each session's
  // always-visible banner row, tracked as plain React state since the banners are a real HTML
  // overlay — not Cytoscape nodes — so they can be independently, directly clickable without
  // reintroducing the canvas-coordinate hit-testing CR-UI-13 had to fix around. Recomputed whenever
  // Cytoscape's viewport or a session node's position changes (see the `cy` callback below).
  const [bannerPositions, setBannerPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );

  function recomputeBannerPositions(cy: Core) {
    const next = new Map<string, { x: number; y: number }>();
    cy.nodes('[type = "session"]').forEach((node: NodeSingular) => {
      const pos = node.renderedPosition();
      const height = node.renderedHeight();
      // Positioned above the session node (matches the approved mockup), anchored by its
      // horizontal center.
      next.set(node.id(), { x: pos.x, y: pos.y - height / 2 });
    });
    setBannerPositions(next);
  }

  // CR-UI-18 (Sprint 4): on-screen position for the 📝 note-badge overlay — same real-HTML-overlay
  // reasoning as `bannerPositions` above, but generalized over EVERY node type with a saved note
  // (project/session/subagent/memory/tool), not just sessions. Recomputed on the same events as the
  // banner layer (see the `cy` callback below) via the shared `recomputeOverlays` helper.
  const [noteBadgePositions, setNoteBadgePositions] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );

  // CR-UI-28 (Sprint 5): sessions whose `hasNotedDescendant` (Indexer v1.8) is true — the session
  // itself or any of its subagent/memory-touch/tool sub-items has a saved note, computed
  // server-side so this works even for a session that has never been drilled down into (its
  // sub-items don't exist as real Cytoscape elements yet — see CR-UI-06's lazy-fetch design).
  const sessionsWithNotedDescendant = useMemo(
    () => new Set(sessions.filter((s) => s.hasNotedDescendant).map((s) => s.id)),
    [sessions],
  );

  function recomputeNoteBadgePositions(cy: Core) {
    const next = new Map<string, { x: number; y: number }>();
    const hasDirectNotes = notedKeys && notedKeys.size > 0;
    if (hasDirectNotes || sessionsWithNotedDescendant.size > 0) {
      cy.nodes().forEach((node: NodeSingular) => {
        const apiType = apiNodeTypeForCyType(node.data("type") as string);
        const rawId = node.data("rawId") as string;
        const hasDirectNote = !!notedKeys && notedKeys.has(`${apiType}:${rawId}`);
        // CR-UI-28: a session node also shows the badge when `hasNotedDescendant` is true — in
        // addition to (not instead of) the existing direct-note check above.
        const hasNotedDescendant = apiType === "session" && sessionsWithNotedDescendant.has(rawId);
        if (!hasDirectNote && !hasNotedDescendant) return;
        const pos = node.renderedPosition();
        const halfWidth = node.renderedOuterWidth() / 2;
        const halfHeight = node.renderedOuterHeight() / 2;
        // Bottom-right corner of the node's rendered box, nudged inward so the badge visually sits
        // on the corner instead of floating fully outside the shape.
        next.set(node.id(), {
          x: pos.x + halfWidth - NOTE_BADGE_INWARD_OFFSET,
          y: pos.y + halfHeight - NOTE_BADGE_INWARD_OFFSET,
        });
      });
    }
    setNoteBadgePositions(next);
  }

  // CR-UI-18: recomputes both overlays together — reuses the banner layer's existing event wiring
  // (pan/zoom/position/layoutstop, see the `cy` callback below) rather than registering a second,
  // duplicate set of listeners just for badges.
  function recomputeOverlays(cy: Core) {
    recomputeBannerPositions(cy);
    recomputeNoteBadgePositions(cy);
  }

  const baseElements: ElementDefinition[] = useMemo(
    () => buildGraphElements(project, sessions, sort),
    [project, sessions, sort],
  );

  const elements: ElementDefinition[] = useMemo(() => {
    const children: ElementDefinition[] = [];
    for (const [sessionId, types] of expandedTypes) {
      const detail = sessionDetails.get(sessionId);
      if (detail && types.size > 0) {
        children.push(...buildChildElements(sessionId, detail, types));
      }
    }
    return [...baseElements, ...children];
  }, [baseElements, expandedTypes, sessionDetails]);

  // CR-UI-13: memoized so its identity (and, for "timeline", its `positions` callback's identity)
  // only changes when the algorithm/project/sessions/sort actually change — not on every render
  // caused by an expand/collapse click (which only changes `elements`). Used as the
  // CytoscapeComponent `layout` prop (its stability is what stops react-cytoscapejs's own
  // prop-diffing from spuriously triggering a second full relayout on an elements-only update) and
  // to decide *whether* an effect below should run (via its identity in the dependency arrays)
  // — but NOT reused as the actual options object passed to `.layout(...).run()` (see
  // `freshLayoutOptions` below).
  const layoutOptions = useMemo(
    () => layoutOptionsFor(layout, project, sessions, sort),
    [layout, project, sessions, sort],
  );

  // CR-UI-09 fix: the "timeline" branch's `positions` callback lazily builds a `childClusterCache`
  // the first time it's asked for a child's position, intended to be built once *per layout run*.
  // But `layoutOptions` above is memoized and reused across several separate `.run()` calls (e.g.
  // clicking ★ then later ◆ on the same session, CR-UI-07) — reusing the exact same closure/cache
  // across those calls means the second call sees the cache built (and now stale) from the first,
  // leaving newly-added siblings unpositioned. So every actual `.layout(...).run()` invocation below
  // builds a brand-new options instance (fresh cache), while the CytoscapeComponent `layout` prop
  // above keeps using the stable memoized one purely for react-cytoscapejs's own diffing.
  function freshLayoutOptions(): LayoutOptions {
    return layoutOptionsFor(layout, project, sessions, sort);
  }

  // CR-UI-13 fix: this used to be a single effect keyed on [layout, elements, project, sessions],
  // so it fired a full (randomized-from-scratch) relayout on *every* expand/collapse click, jumping
  // unrelated nodes to new positions. Split into two effects with distinct intent:

  // (a) Full relayout — only when the algorithm choice (or the project/sessions it's computed from)
  // actually changes. This is the one case where fully reorganizing the graph is expected/desired.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout(freshLayoutOptions()).run();
    // Deliberately keyed on the memoized `layoutOptions` (not `freshLayoutOptions()`, which would
    // be a new reference every render) — this effect should fire only when the algorithm/project/
    // sessions/sort actually change, not on every render.
  }, [layoutOptions]);

  // (b) Scoped relayout — when `elements` changes (drill-down expand/collapse) without the layout
  // itself changing. Locks every node that already existed *before* this update before running, so
  // the layout algorithm only positions the newly added (brand-new child) elements; unrelated nodes
  // are guaranteed not to move. Tracks the previously-seen `layoutOptions` so it can tell whether
  // effect (a) already handled a full relayout in this same commit (e.g. switching project, which
  // changes both `elements` and `layoutOptions` together) and skip a redundant second run in that
  // case.
  // CR-UI-07 refinement: with per-banner independent toggling, a session's children can now arrive
  // across several separate `elements` changes (e.g. click ★ then later click ◆) rather than all at
  // once. CR-UI-09's Timeline radial cluster sizes itself by the *current total* sibling count, so
  // locking a session's already-placed children while a sibling batch is added would freeze them at
  // a stale (smaller-n) radius instead of letting the whole cluster reflow to the correct spacing.
  // So: any pre-existing node whose `parentSessionId` had a child added or removed this update is
  // left unlocked too (its whole cluster reflows together) — every other pre-existing node (other
  // sessions/project, and other sessions' untouched children) stays locked, preserving CR-UI-13's
  // "unrelated nodes never move" guarantee.
  const prevLayoutOptionsRef = useRef(layoutOptions);
  const prevElementsRef = useRef<ElementDefinition[]>(elements);
  useEffect(() => {
    const cy = cyRef.current;
    const layoutOptionsChanged = prevLayoutOptionsRef.current !== layoutOptions;
    prevLayoutOptionsRef.current = layoutOptions;

    const previousElements = prevElementsRef.current;
    prevElementsRef.current = elements;

    if (!cy || layoutOptionsChanged) return;

    const previousNodeIds = new Set(
      previousElements.filter((e) => !("source" in e.data)).map((e) => e.data.id as string),
    );
    const currentNodeIds = new Set(
      elements.filter((e) => !("source" in e.data)).map((e) => e.data.id as string),
    );
    const parentOf = new Map<string, string>();
    for (const e of [...previousElements, ...elements]) {
      if (!("source" in e.data) && e.data.parentSessionId) {
        parentOf.set(e.data.id as string, e.data.parentSessionId as string);
      }
    }

    const changedParents = new Set<string>();
    for (const [id, parent] of parentOf) {
      if (previousNodeIds.has(id) !== currentNodeIds.has(id)) changedParents.add(parent);
    }

    const preExisting = cy.nodes().filter((n) => {
      if (!previousNodeIds.has(n.id())) return false; // brand new — never lock
      const parent = parentOf.get(n.id());
      if (parent && changedParents.has(parent)) return false; // this cluster is reflowing
      return true;
    });
    preExisting.lock();
    cy.layout(freshLayoutOptions()).run();
    preExisting.unlock();
  }, [elements, layoutOptions]);

  // CR-UI-11: Cytoscape sizes its internal <canvas> layers to its container's pixel dimensions at
  // creation time and on the browser's own `window` resize event — it has no built-in awareness of
  // a *container* resize that isn't accompanied by a window resize (e.g. the Detail panel's drag
  // handle shrinking/growing `.canvas-area`). Without this, the canvas keeps its stale (pre-drag)
  // size, which can visually/functionally overlap neighboring elements like the resize handle.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const cy = cyRef.current;
      cy?.resize();
      if (cy) recomputeOverlays(cy);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Reflect external selection state (e.g. programmatic) onto the canvas.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("selected");
    if (selectedSessionId) {
      cy.getElementById(selectedSessionId).addClass("selected");
    }
  }, [selectedSessionId, elements]);

  // CR-UI-18: `notedKeys` changing (e.g. the Content tab's Save/Delete, applied optimistically in
  // App.tsx) isn't itself a Cytoscape layout/viewport event — nothing in the `cy` callback's
  // pan/zoom/position/layoutstop wiring above would otherwise fire to pick up the new set, so a
  // freshly-saved/-deleted note's badge wouldn't appear/disappear until the next unrelated
  // layout/pan/zoom. Also re-runs when `elements` changes (e.g. expanding a session whose child
  // already has a saved note) so that child's badge appears without an extra event.
  // CR-UI-28: also re-runs when `sessionsWithNotedDescendant` changes — App.tsx re-fetches the
  // sessions list after a note mutation, so a note added/removed on a (possibly never-expanded)
  // sub-item updates its parent session's badge without a full page reload.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    recomputeNoteBadgePositions(cy);
  }, [notedKeys, elements, sessionsWithNotedDescendant]);

  // CR-UI-07: toggle ONE drill-down type for a session, independently of the other two (replaces
  // CR-UI-06's all-or-nothing `toggleSessionExpansion` — each banner now expands only its own
  // type). Collapsing removes just that type's children; expanding fetches (or reuses cached)
  // detail and adds only that type's children if it has any — a type with zero items for this
  // session adds no child nodes and shows no error, generalizing CR-UI-06's original guarantee
  // (VZ-2.3 acceptance 3) to the per-type case.
  async function toggleBannerType(sessionId: string, type: DrillDownType) {
    const current = expandedTypes.get(sessionId);
    if (current?.has(type)) {
      setExpandedTypes((prev) => {
        const next = new Map(prev);
        const types = new Set(next.get(sessionId));
        types.delete(type);
        if (types.size === 0) next.delete(sessionId);
        else next.set(sessionId, types);
        return next;
      });
      return;
    }

    let detail = sessionDetails.get(sessionId);
    if (!detail) {
      try {
        detail = await fetchSessionDetail(project.id, sessionId);
      } catch {
        // Local-only, best-effort UI affordance: a failed detail fetch simply leaves the banner
        // collapsed rather than surfacing a separate error channel for this drill-down interaction.
        return;
      }
      setSessionDetails((prev) => new Map(prev).set(sessionId, detail as SessionDetail));
    }

    const countFor: Record<DrillDownType, number> = {
      subagent: detail.subagents.length,
      memory: detail.memoryTouches.length,
      tool: detail.overflows.length,
    };
    if (countFor[type] === 0) return;

    setExpandedTypes((prev) => {
      const next = new Map(prev);
      const types = new Set(next.get(sessionId) ?? []);
      types.add(type);
      next.set(sessionId, types);
      return next;
    });
  }

  // CR-UI-07 (reopen, Sprint 4): restores the session-body-click expand-all/collapse-all toggle
  // (CR-UI-06's original all-or-nothing gesture, removed by CR-UI-07's per-banner-only change) as an
  // ADDITION alongside the still-independent per-banner single-type toggles above — not a
  // replacement. Body click: expand all 3 types if any are currently missing (regardless of whether
  // the present ones got there via the body or their own banner), or collapse to empty only when all
  // 3 are already present. Unlike `toggleBannerType`, this doesn't skip a zero-count type — it still
  // adds it to the expanded set for consistency with "all 3", but `buildChildElements`/the `elements`
  // memo above render nothing extra for it either way (an empty array `.forEach` is a no-op).
  const ALL_DRILLDOWN_TYPES: DrillDownType[] = ["subagent", "memory", "tool"];
  async function toggleAllTypesForSession(sessionId: string) {
    const current = expandedTypes.get(sessionId);
    const allExpanded = ALL_DRILLDOWN_TYPES.every((t) => current?.has(t));
    if (allExpanded) {
      setExpandedTypes((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      return;
    }

    if (!sessionDetails.has(sessionId)) {
      try {
        const detail = await fetchSessionDetail(project.id, sessionId);
        setSessionDetails((prev) => new Map(prev).set(sessionId, detail));
      } catch {
        // Same best-effort affordance as `toggleBannerType`: a failed detail fetch simply leaves
        // expansion as-is rather than surfacing a separate error channel.
        return;
      }
    }

    setExpandedTypes((prev) => new Map(prev).set(sessionId, new Set(ALL_DRILLDOWN_TYPES)));
  }

  return (
    <div className="graph-canvas-wrapper" ref={wrapperRef}>
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        style={{ width: "100%", height: "100%" }}
        layout={layoutOptions}
        cy={(cy: Core) => {
          cyRef.current = cy;
          // Test hook only (Playwright e2e, VZ-1.6/1.9): lets tests locate a node's real rendered
          // position to simulate a genuine canvas click, since Cytoscape renders to <canvas> with no
          // per-node DOM to select. Harmless in a local, single-user, read-mostly tool.
          (window as unknown as { __cy?: Core }).__cy = cy;
          cy.off("tap", "node");
          cy.on("tap", "node", (evt) => {
            const node = evt.target;
            const type = node.data("type") as string;
            // CR-UI-07 (reopen, Sprint 4): clicking the session node body selects it for the detail
            // panel (unchanged) AND toggles expand-all/collapse-all across all 3 drill-down types
            // (restored — Sprint 3 had made body-click selection-only, expansion exclusively a
            // per-banner action; those per-banner toggles remain independent and unchanged below).
            if (type === "session") {
              onSelectSession(node.id());
              // CR-UI-04: `sessionId` is the item's own id for a session selection — drives the
              // Detail panel's Info-tab Resume command field (reopen, Sprint 5: no longer a separate
              // Terminal tab).
              onSelectItem({
                nodeType: "session",
                rawId: node.id(),
                label: node.data("label"),
                sessionId: node.id(),
              });
              void toggleAllTypesForSession(node.id());
            } else if (type === "subagent" || type === "memory" || type === "tool") {
              // CR-UI-08: drill-down child nodes are now selectable too (previously inert), driving
              // the Detail panel's Content tab for whichever item type is clicked.
              // CR-UI-04: `sessionId` here is the child's *parent* session's id (`parentSessionId`)
              // — there's no per-sub-item resume concept, the Resume command field always resumes
              // the owning session.
              onSelectItem({
                nodeType: toApiNodeType(type as DrillDownType),
                rawId: node.data("rawId"),
                label: node.data("label"),
                sessionId: node.data("parentSessionId") as string,
                // CR-UI-15: "Agent Path"/"Tool Path" data + the Content tab's Agent/Tool fetch —
                // undefined for memory (its `rawId` above already is the file path).
                filePath: node.data("filePath") as string | undefined,
              });
            } else if (type === "project") {
              onSelectItem({ nodeType: "project", rawId: node.data("rawId"), label: node.data("label") });
            }
          });
          cy.off("layoutstop");
          cy.on("layoutstop", () => {
            setAppliedLayout(pendingLayoutRef.current);
            recomputeOverlays(cy);
          });
          // CR-UI-07: keep the banner overlay glued to its session node across pans/zooms and
          // direct node drags (which don't trigger a "layoutstop"). NOTE: deliberately event-driven
          // only — this `cy` callback prop itself re-runs on every React re-render (react-cytoscapejs
          // calls it from both componentDidMount and componentDidUpdate), so calling
          // `recomputeOverlays` unconditionally here (rather than from a Cytoscape event) would
          // set state on every render and re-trigger itself indefinitely (React error #185).
          // CR-UI-18: the `position` listener below is scoped to every node (not just sessions) —
          // the note-badge overlay generalizes over all node types, so any node's drag needs to
          // re-track its badge; reused here rather than adding a second, duplicate listener.
          cy.off("pan zoom");
          cy.on("pan zoom", () => recomputeOverlays(cy));
          cy.off("position", "node");
          cy.on("position", "node", () => recomputeOverlays(cy));
        }}
      />
      {showBanners && (
        <div className="session-banner-layer">
          {sessions.map((s) => {
            const pos = bannerPositions.get(s.id);
            if (!pos) return null;
            return (
              <div
                key={s.id}
                className="session-banner-row"
                data-testid="session-banner-row"
                data-session-id={s.id}
                style={{ left: pos.x, top: pos.y }}
              >
                <button
                  type="button"
                  className="session-banner session-banner-memory"
                  data-banner="memory"
                  aria-label={`Memory touches: ${s.memoryTouchCount}. Click to toggle.`}
                  onClick={() => void toggleBannerType(s.id, "memory")}
                >
                  ★ {s.memoryTouchCount}
                </button>
                <button
                  type="button"
                  className="session-banner session-banner-subagent"
                  data-banner="subagent"
                  aria-label={`Subagents: ${s.subagentCount}. Click to toggle.`}
                  onClick={() => void toggleBannerType(s.id, "subagent")}
                >
                  ◆ {s.subagentCount}
                </button>
                <button
                  type="button"
                  className="session-banner session-banner-tool"
                  data-banner="tool"
                  aria-label={`Tool results: ${s.toolResultCount}. Click to toggle.`}
                  onClick={() => void toggleBannerType(s.id, "tool")}
                >
                  ⚙ {s.toolResultCount}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {/* CR-UI-18 (Sprint 4): bottom-right corner badge overlay for the 📝 note indicator, replacing
          the old in-label suffix — generalized over every node type with a saved note (not just
          sessions), unlike the `showBanners`-gated layer above; independent of that preference. */}
      <div className="note-badge-layer">
        {[...noteBadgePositions.entries()].map(([nodeId, pos]) => (
          <span
            key={nodeId}
            className="note-badge"
            data-testid="note-badge"
            data-node-id={nodeId}
            style={{ left: pos.x, top: pos.y }}
          >
            📝
          </span>
        ))}
      </div>
      {/* Visually hidden test hook — not part of the approved mockup (D6). Lets Playwright assert
          node count and the currently-applied Cytoscape layout without pixel diffing or reaching
          into canvas internals. */}
      <span
        className="sr-only"
        data-testid="graph-status"
        data-node-count={elements.filter((e) => !("source" in e.data)).length}
        data-layout={appliedLayout}
      />
    </div>
  );
}
