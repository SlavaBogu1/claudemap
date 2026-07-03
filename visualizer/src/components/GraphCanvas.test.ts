import { describe, it, expect } from "vitest";
import {
  buildGraphElements,
  buildChildElements,
  computeChildClusterPositions,
  computeChildRowPositions,
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
    hasNotedDescendant: false,
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
        { agentId: "a1", agentType: "code-review", description: "review", filePath: "agents/a1.jsonl" },
        { agentId: "a2", agentType: "test-gen", description: "tests", filePath: "agents/a2.jsonl" },
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

  it("CR-UI-22: uses the simplified fixed label text for each drill-down type — no agent type/filename in-label", () => {
    const detail: SessionDetail = {
      subagents: [
        { agentId: "a1", agentType: "code-review", description: "review", filePath: "agents/a1.jsonl" },
      ],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "tool_x", filePath: "C:\\overflow\\tool_x.txt" }],
    };
    const nodes = buildChildElements("s0", detail).filter((e) => !("source" in e.data));
    const [subagentNode, memoryNode, toolNode] = nodes;
    expect(subagentNode.data.label).toBe("◆ Agent");
    expect(memoryNode.data.label).toBe("★ Memory");
    expect(toolNode.data.label).toBe("⚙ Tool log");
  });

  it("CR-UI-15: carries subagent/tool filePath into node data (Agent/Tool Path source), distinct from rawId", () => {
    const detail: SessionDetail = {
      subagents: [
        { agentId: "a1", agentType: "code-review", description: "review", filePath: "agents/a1.jsonl" },
      ],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    };
    const nodes = buildChildElements("s0", detail).filter((e) => !("source" in e.data));
    const [subagentNode, memoryNode, toolNode] = nodes;
    expect(subagentNode.data.filePath).toBe("agents/a1.jsonl");
    expect(subagentNode.data.rawId).toBe("a1");
    expect(toolNode.data.filePath).toBe("overflow/tool_x.txt");
    expect(toolNode.data.rawId).toBe("tool_x");
    // Memory's rawId already *is* the file path — no separate filePath field needed.
    expect(memoryNode.data.rawId).toBe("memory/PLAN.md");
  });

  it("adds zero elements for a session with no substructure", () => {
    const detail: SessionDetail = { subagents: [], memoryTouches: [], overflows: [] };
    expect(buildChildElements("s0", detail)).toHaveLength(0);
  });

  it("CR-UI-22: a null memory-touch name renders the same fixed label without crashing (name no longer used in-label)", () => {
    const detail: SessionDetail = {
      subagents: [],
      memoryTouches: [{ filePath: "C:\\Users\\me\\memory\\deleted-topic.md", name: null }],
      overflows: [],
    };
    const [memoryNode] = buildChildElements("s0", detail).filter((e) => !("source" in e.data));
    expect(memoryNode.data.label).toBe("★ Memory");
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

describe("computeChildRowPositions (CR-UI-16 Timeline per-type rows)", () => {
  const parentPos = { x: 500, y: 200 };

  it("returns no positions when every row is empty", () => {
    expect(computeChildRowPositions(parentPos, [{ ids: [] }, { ids: [] }, { ids: [] }])).toEqual({});
  });

  it("assigns each present row a distinct, increasing y — a type with zero items gets no row (no gap)", () => {
    const positions = computeChildRowPositions(parentPos, [
      { ids: ["m1", "m2"] }, // memory
      { ids: [] }, // subagent — absent
      { ids: ["t1"] }, // tool
    ]);
    expect(positions.m1.y).toBe(positions.m2.y);
    // Tool lands in the very next row after Memory — one row step, not two (no reserved gap for
    // the absent Subagent row).
    const rowStep = positions.t1.y - positions.m1.y;
    expect(rowStep).toBeGreaterThan(0);

    const onlyTwoRows = computeChildRowPositions(parentPos, [{ ids: ["m1"] }, { ids: [] }, { ids: ["t1"] }]);
    expect(onlyTwoRows.t1.y - onlyTwoRows.m1.y).toBe(rowStep);
  });

  it("orders rows Memory, then Subagent, then Tool, top-to-bottom (increasing y) when all three are present", () => {
    const positions = computeChildRowPositions(parentPos, [
      { ids: ["m1"] },
      { ids: ["s1"] },
      { ids: ["t1"] },
    ]);
    expect(positions.m1.y).toBeLessThan(positions.s1.y);
    expect(positions.s1.y).toBeLessThan(positions.t1.y);
  });

  it("spaces 10 same-row siblings evenly along x with no two sharing a position", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `child${i}`);
    const positions = computeChildRowPositions(parentPos, [{ ids }]);
    const xs = ids.map((id) => positions[id].x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThan(20);
    }
    // Centered under the parent.
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeCloseTo(parentPos.x, 0);
  });

  it("a single-item row is centered directly under the parent (no unnecessary offset)", () => {
    const positions = computeChildRowPositions(parentPos, [{ ids: ["only"] }]);
    expect(positions.only.x).toBe(parentPos.x);
  });

  it("is deterministic — same input in the same order produces the same positions", () => {
    const rows = [{ ids: ["m1", "m2"] }, { ids: ["s1"] }, { ids: ["t1", "t2"] }];
    expect(computeChildRowPositions(parentPos, rows)).toEqual(computeChildRowPositions(parentPos, rows));
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
        hasNotedDescendant: false,
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
        hasNotedDescendant: false,
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
        hasNotedDescendant: false,
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
