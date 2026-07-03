import { describe, it, expect } from "vitest";
import {
  buildGraphElements,
  buildChildElements,
  computeChildClusterPositions,
  sortSessions,
} from "./GraphCanvas";
import type { Project, Session, SessionDetail } from "../types";

const project: Project = {
  id: "proj1",
  path: "C:/Users/me/repos/sudoku",
  sessionCount: 0,
  lastActiveAt: "2026-07-01T00:00:00Z",
};

function makeSessions(count: number): Session[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    startedAt: "2026-07-01T00:00:00Z",
    endedAt: "2026-07-01T01:00:00Z",
    messageCount: 10,
    gitBranch: "main",
    preview: `session ${i}`,
    subagentCount: 0,
    touchedMemory: false,
    memoryTouchCount: 0,
    toolResultCount: 0,
  }));
}

describe("buildGraphElements (VZ-1.5 extremes)", () => {
  it("renders 1 project node + 1 session node + 1 edge for a single-session project", () => {
    const elements = buildGraphElements(project, makeSessions(1));
    const nodes = elements.filter((e) => !("source" in e.data));
    const edges = elements.filter((e) => "source" in e.data);
    expect(nodes).toHaveLength(2); // project + 1 session
    expect(edges).toHaveLength(1);
  });

  it("renders 1 project node + 20 session nodes + 20 edges for a 20-session project", () => {
    const elements = buildGraphElements(project, makeSessions(20));
    const nodes = elements.filter((e) => !("source" in e.data));
    const edges = elements.filter((e) => "source" in e.data);
    expect(nodes).toHaveLength(21); // project + 20 sessions
    expect(edges).toHaveLength(20);
  });

  it("does not assume a minimum session count — renders gracefully with 0 sessions", () => {
    const elements = buildGraphElements(project, []);
    expect(elements).toHaveLength(1); // just the project node
  });
});

describe("buildChildElements (VZ-2.3 drill-down)", () => {
  it("adds exactly 4 child nodes + 4 edges for 2 subagents + 1 memory touch + 1 tool result", () => {
    const detail: SessionDetail = {
      subagents: [
        { agentId: "a1", agentType: "code-review", description: "review" },
        { agentId: "a2", agentType: "test-gen", description: "tests" },
      ],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    };
    const elements = buildChildElements("s0", detail);
    const nodes = elements.filter((e) => !("source" in e.data));
    const edges = elements.filter((e) => "source" in e.data);
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(4);

    // CR-UI-14: the Cytoscape node type value is "tool" (renamed from "overflow") — the API
    // contract's SessionDetail.overflows field name itself is unchanged, a separate naming layer.
    const types = nodes.map((n) => n.data.type).sort();
    expect(types).toEqual(["memory", "subagent", "subagent", "tool"]);
    expect(edges.every((e) => e.data.source === "s0")).toBe(true);
  });

  it("labels subagents by agentType, memory touches by name, Tool items by file basename", () => {
    const detail: SessionDetail = {
      subagents: [{ agentId: "a1", agentType: "code-review", description: "review" }],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "tool_x", filePath: "C:\\overflow\\tool_x.txt" }],
    };
    const nodes = buildChildElements("s0", detail).filter((e) => !("source" in e.data));
    const [subagentNode, memoryNode, toolNode] = nodes;
    expect(subagentNode.data.label).toContain("code-review");
    expect(memoryNode.data.label).toContain("PLAN.md");
    expect(toolNode.data.label).toContain("tool_x.txt");
    expect(toolNode.data.label).toContain("⚙ Tool");
  });

  it("adds zero elements for a session with no substructure", () => {
    const detail: SessionDetail = { subagents: [], memoryTouches: [], overflows: [] };
    expect(buildChildElements("s0", detail)).toHaveLength(0);
  });

  it("falls back to the file basename (not the literal string 'null') when a memory touch's name is null", () => {
    const detail: SessionDetail = {
      subagents: [],
      memoryTouches: [{ filePath: "C:\\Users\\me\\memory\\deleted-topic.md", name: null }],
      overflows: [],
    };
    const [memoryNode] = buildChildElements("s0", detail).filter((e) => !("source" in e.data));
    expect(memoryNode.data.label).toContain("deleted-topic.md");
    expect(memoryNode.data.label).not.toContain("null");
  });
});

describe("computeChildClusterPositions (CR-UI-09 Timeline radial cluster)", () => {
  const parentPos = { x: 500, y: 200 };

  it("returns no positions for zero children", () => {
    expect(computeChildClusterPositions(parentPos, [])).toEqual({});
  });

  it("places 10 children with no two sharing a position, all above a minimum pairwise distance", () => {
    const childIds = Array.from({ length: 10 }, (_, i) => `child${i}`);
    const positions = computeChildClusterPositions(parentPos, childIds);
    const pts = Object.values(positions);
    expect(pts).toHaveLength(10);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(dist).toBeGreaterThan(20);
      }
    }
  });

  it("keeps 1-2 children clearly separated from the parent (radius has a sensible minimum)", () => {
    const one = computeChildClusterPositions(parentPos, ["only"]);
    const distFromParent = Math.hypot(one.only.x - parentPos.x, one.only.y - parentPos.y);
    expect(distFromParent).toBeGreaterThan(20);

    const two = computeChildClusterPositions(parentPos, ["a", "b"]);
    const distBetween = Math.hypot(two.a.x - two.b.x, two.a.y - two.b.y);
    expect(distBetween).toBeGreaterThan(20);
  });

  it("is deterministic — same childIds in the same order produce the same positions", () => {
    const childIds = ["a", "b", "c", "d"];
    expect(computeChildClusterPositions(parentPos, childIds)).toEqual(
      computeChildClusterPositions(parentPos, childIds),
    );
  });

  it("scales radius with child count (20 children spread further than 3)", () => {
    const few = computeChildClusterPositions(parentPos, ["a", "b", "c"]);
    const many = computeChildClusterPositions(
      parentPos,
      Array.from({ length: 20 }, (_, i) => `c${i}`),
    );
    const fewRadius = Math.hypot(few.a.x - parentPos.x, few.a.y - parentPos.y - 0); // approx radius
    const manyRadius = Math.hypot(many.c0.x - parentPos.x, many.c0.y - parentPos.y);
    expect(manyRadius).toBeGreaterThan(fewRadius);
  });
});

describe("sortSessions / buildGraphElements sort (CR-UI-10)", () => {
  function makeVariedSessions(): Session[] {
    return [
      {
        id: "s-mid",
        startedAt: "2026-06-22T10:00:00Z",
        endedAt: "2026-06-22T10:30:00Z",
        messageCount: 5,
        gitBranch: "main",
        preview: "mid",
        subagentCount: 2,
        touchedMemory: false,
        memoryTouchCount: 0,
        toolResultCount: 0,
      },
      {
        id: "s-early",
        startedAt: "2026-06-20T10:00:00Z",
        endedAt: "2026-06-20T10:30:00Z",
        messageCount: 5,
        gitBranch: "main",
        preview: "early",
        subagentCount: 5,
        touchedMemory: false,
        memoryTouchCount: 0,
        toolResultCount: 0,
      },
      {
        id: "s-late",
        startedAt: "2026-06-25T10:00:00Z",
        endedAt: "2026-06-25T10:30:00Z",
        messageCount: 5,
        gitBranch: "main",
        preview: "late",
        subagentCount: 0,
        touchedMemory: false,
        memoryTouchCount: 0,
        toolResultCount: 0,
      },
    ];
  }

  it("date-desc (default) orders newest first", () => {
    const sorted = sortSessions(makeVariedSessions(), "date-desc");
    expect(sorted.map((s) => s.id)).toEqual(["s-late", "s-mid", "s-early"]);
  });

  it("date-asc orders oldest first", () => {
    const sorted = sortSessions(makeVariedSessions(), "date-asc");
    expect(sorted.map((s) => s.id)).toEqual(["s-early", "s-mid", "s-late"]);
  });

  it("agents-desc orders most subagents first", () => {
    const sorted = sortSessions(makeVariedSessions(), "agents-desc");
    expect(sorted.map((s) => s.id)).toEqual(["s-early", "s-mid", "s-late"]);
  });

  it("agents-asc orders fewest subagents first", () => {
    const sorted = sortSessions(makeVariedSessions(), "agents-asc");
    expect(sorted.map((s) => s.id)).toEqual(["s-late", "s-mid", "s-early"]);
  });

  it("does not mutate the input array", () => {
    const sessions = makeVariedSessions();
    const original = sessions.map((s) => s.id);
    sortSessions(sessions, "date-asc");
    expect(sessions.map((s) => s.id)).toEqual(original);
  });

  it("buildGraphElements applies the sort before mapping to nodes/edges", () => {
    const elements = buildGraphElements(project, makeVariedSessions(), "agents-desc");
    const sessionNodeIds = elements
      .filter((e) => !("source" in e.data) && e.data.type === "session")
      .map((e) => e.data.id);
    expect(sessionNodeIds).toEqual(["s-early", "s-mid", "s-late"]);
  });

  it("defaults to date-desc when no sort is passed (back-compat)", () => {
    const elements = buildGraphElements(project, makeVariedSessions());
    const sessionNodeIds = elements
      .filter((e) => !("source" in e.data) && e.data.type === "session")
      .map((e) => e.data.id);
    expect(sessionNodeIds).toEqual(["s-late", "s-mid", "s-early"]);
  });
});
