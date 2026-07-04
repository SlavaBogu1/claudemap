import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  buildGraphElements,
  buildChildElements,
  computeChildClusterPositions,
  computeChildRowPositions,
  computeTimelinePositions,
  hexToRgb,
  interpolateColor,
  normalizedSessionMetric,
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

describe("formatSessionLabel via buildGraphElements (CR-UI-32)", () => {
  it("session node label has exactly 3 lines: date, time, then the message count", () => {
    const sessions = makeSessions(1).map((s) => ({ ...s, messageCount: 42 }));
    const elements = buildGraphElements(project, sessions);
    const sessionNode = elements.find((e) => !("source" in e.data) && e.data.type === "session");
    const lines = (sessionNode?.data.label as string).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("42");
  });

  it("a session with 0 messages renders 0 on the third line, not blank/undefined", () => {
    const sessions = makeSessions(1).map((s) => ({ ...s, messageCount: 0 }));
    const elements = buildGraphElements(project, sessions);
    const sessionNode = elements.find((e) => !("source" in e.data) && e.data.type === "session");
    const lines = (sessionNode?.data.label as string).split("\n");
    expect(lines[2]).toBe("0");
  });

  it("the project node's label is unaffected (unrelated, single-line)", () => {
    const elements = buildGraphElements(project, makeSessions(1));
    const projectNode = elements.find((e) => !("source" in e.data) && e.data.type === "project");
    expect((projectNode?.data.label as string).includes("\n")).toBe(false);
  });
});

describe("computeTimelinePositions (CR-UI-29 cascade-stack)", () => {
  function sessionAt(id: string, startedAt: string): Session {
    return {
      id,
      startedAt,
      endedAt: startedAt,
      messageCount: 1,
      gitBranch: "main",
      preview: id,
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
      hasNotedDescendant: false,
    };
  }

  it("returns a fixed centered position for the project node", () => {
    const { positions } = computeTimelinePositions(project, []);
    expect(positions[`project:${project.id}`]).toEqual({ x: 500, y: 0 });
  });

  it("a day with exactly 1 session renders with no cascade offset (flat tile at the baseline)", () => {
    const { positions, zIndex } = computeTimelinePositions(project, [
      sessionAt("s1", "2026-06-20T10:00:00Z"),
    ]);
    expect(positions.s1.y).toBe(200); // TIMELINE_SESSION_Y baseline
    expect(zIndex.s1).toBe(1);
  });

  it("N=15 same-day sessions cascade uncapped, incrementing by exactly one step each, no reset", () => {
    // Identical startedAt across all 15 -> baseX is identical for every session (span === 0), so any
    // x/y difference between successive sessions is purely the cascade step (stable sort preserves
    // this array's insertion order as the chronological/cascade order when timestamps tie).
    const sessions = Array.from({ length: 15 }, (_, i) => sessionAt(`s${i}`, "2026-06-20T10:00:00Z"));
    const { positions, zIndex } = computeTimelinePositions(project, sessions);
    for (let i = 1; i < 15; i++) {
      const prev = positions[`s${i - 1}`];
      const curr = positions[`s${i}`];
      expect(curr.x - prev.x).toBe(18); // TIMELINE_CASCADE_X_STEP
      expect(curr.y - prev.y).toBe(18); // TIMELINE_CASCADE_Y_STEP
      expect(zIndex[`s${i}`]).toBe(zIndex[`s${i - 1}`] + 1);
    }
    // The day's last (most recent) session has the highest zIndex among the day's sessions.
    expect(zIndex.s14).toBe(Math.max(...Object.values(zIndex)));
  });

  it("across 2+ distinct days, each day's chronologically-earliest session shares the same baseline Y", () => {
    const sessions = [
      sessionAt("day1-a", "2026-06-20T09:00:00Z"),
      sessionAt("day1-b", "2026-06-20T10:00:00Z"),
      sessionAt("day1-c", "2026-06-20T11:00:00Z"),
      sessionAt("day2-a", "2026-06-21T09:00:00Z"),
    ];
    const { positions } = computeTimelinePositions(project, sessions);
    expect(positions["day1-a"].y).toBe(200);
    expect(positions["day2-a"].y).toBe(200); // shared baseline, not cumulatively offset by day1
    expect(positions["day1-b"].y).toBe(200 + 18);
    expect(positions["day1-c"].y).toBe(200 + 36);
  });

  it("X position's calculation basis is unchanged — still linear by startedAt across days", () => {
    const sessions = [
      sessionAt("early", "2026-06-20T10:00:00Z"),
      sessionAt("mid", "2026-06-22T10:00:00Z"),
      sessionAt("late", "2026-06-25T10:00:00Z"),
    ];
    const { positions } = computeTimelinePositions(project, sessions);
    expect(positions.early.x).toBeLessThan(positions.mid.x);
    expect(positions.mid.x).toBeLessThan(positions.late.x);
  });
});

describe("computeTimelinePositions (CR-UI-29 reopened 2026-07-04: local-vs-UTC day boundary regression)", () => {
  // The reported regression: calendarDayKey grouped by the session's UTC calendar date, but the
  // label the user actually sees (formatSessionLabel) is formatted in the viewer's LOCAL timezone.
  // Near a UTC day boundary, a late-evening local session can land on the next UTC calendar day
  // while an afternoon session the same local day does not — splitting sessions the user sees as
  // "the same day" into separate cascade groups. These tests force a real viewer timezone
  // (America/New_York, UTC-4 in late May under DST) so the fixture Date objects' local-vs-UTC
  // calendar days actually diverge — unlike every other fixture in this file, which is authored in
  // Z-suffixed UTC and can never exercise this mismatch (the exact gap that let the bug ship).
  // Accessed via `globalThis as any` rather than the bare `process` global: this app's tsconfig
  // (browser-only, `types: ["vite/client"]`) has no Node type declarations, and adding them project-
  // wide is out of scope for this fix — this keeps the workaround local to the one test that needs it.
  const nodeProcess = (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process;
  let originalTz: string | undefined;

  beforeAll(() => {
    originalTz = nodeProcess?.env.TZ;
    if (nodeProcess) nodeProcess.env.TZ = "America/New_York";
  });

  afterAll(() => {
    if (!nodeProcess) return;
    if (originalTz === undefined) delete nodeProcess.env.TZ;
    else nodeProcess.env.TZ = originalTz;
  });

  function sessionAt(id: string, startedAt: string): Session {
    return {
      id,
      startedAt,
      endedAt: startedAt,
      messageCount: 1,
      gitBranch: "main",
      preview: id,
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
      hasNotedDescendant: false,
    };
  }

  it("groups two sessions that share the LOCAL calendar day but fall on different UTC days into the same cascade (the reported bug: May 25 1:55 PM and 8:58 PM local)", () => {
    // 1:55 PM America/New_York (EDT, UTC-4) on May 25 -> 17:55 UTC, same UTC day (May 25).
    // 8:58 PM America/New_York on May 25 -> 00:58 UTC the NEXT day (May 26) — the exact scenario
    // from the user's screenshots.
    const sessions = [
      sessionAt("afternoon", "2026-05-25T17:55:00Z"),
      sessionAt("evening", "2026-05-26T00:58:00Z"),
    ];
    const { positions, zIndex } = computeTimelinePositions(project, sessions);

    // Same cascade group -> the later (evening) session sits exactly one cascade step below/right
    // of the earlier (afternoon) session's baseline, not at its own separate baseline Y.
    expect(positions.afternoon.y).toBe(200); // TIMELINE_SESSION_Y baseline
    expect(positions.evening.y).toBe(200 + 18); // cascaded, NOT also at the baseline
    expect(positions.evening.x - positions.afternoon.x).toBeGreaterThanOrEqual(18);
    expect(zIndex.evening).toBe(zIndex.afternoon + 1);
  });

  it("negative case: two sessions on genuinely different LOCAL calendar days are NOT merged, even when their UTC calendar dates are the same", () => {
    // 11:50 PM America/New_York on May 25 -> 03:50 UTC on May 26.
    // 12:10 AM America/New_York on May 26 -> 04:10 UTC on May 26 (same UTC day as above, but a
    // genuinely different LOCAL calendar day just after local midnight).
    const sessions = [
      sessionAt("lateMay25", "2026-05-26T03:50:00Z"),
      sessionAt("earlyMay26", "2026-05-26T04:10:00Z"),
    ];
    const { positions, zIndex } = computeTimelinePositions(project, sessions);

    // Each is the lone/first session of its own local day -> both at the shared baseline Y, no
    // cascade offset between them, and no zIndex relationship implying a shared group.
    expect(positions.lateMay25.y).toBe(200);
    expect(positions.earlyMay26.y).toBe(200);
    expect(zIndex.lateMay25).toBe(1);
    expect(zIndex.earlyMay26).toBe(1);
  });
});

describe("CR-UI-33 gradient color helpers", () => {
  it("hexToRgb parses a 6-digit hex color", () => {
    expect(hexToRgb("#d64545")).toEqual([0xd6, 0x45, 0x45]);
  });

  it("hexToRgb parses a 3-digit shorthand hex color", () => {
    expect(hexToRgb("#f00")).toEqual([0xff, 0, 0]);
  });

  it("interpolateColor returns the low color at t=0 and high color at t=1", () => {
    expect(interpolateColor("#000000", "#ffffff", 0)).toBe("rgb(0, 0, 0)");
    expect(interpolateColor("#000000", "#ffffff", 1)).toBe("rgb(255, 255, 255)");
  });

  it("interpolateColor clamps out-of-range t", () => {
    expect(interpolateColor("#000000", "#ffffff", -5)).toBe("rgb(0, 0, 0)");
    expect(interpolateColor("#000000", "#ffffff", 5)).toBe("rgb(255, 255, 255)");
  });

  it("interpolateColor produces a midpoint value at t=0.5", () => {
    expect(interpolateColor("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
  });

  function sessionWith(id: string, overrides: Partial<Session>): Session {
    return {
      id,
      startedAt: "2026-06-20T10:00:00Z",
      endedAt: "2026-06-20T11:00:00Z",
      messageCount: 10,
      gitBranch: "main",
      preview: id,
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
      hasNotedDescendant: false,
      ...overrides,
    };
  }

  it("normalizedSessionMetric (sizeGrad): highest messageCount normalizes to 1, lowest to 0", () => {
    const low = sessionWith("low", { messageCount: 5 });
    const mid = sessionWith("mid", { messageCount: 50 });
    const high = sessionWith("high", { messageCount: 100 });
    const sessions = [low, mid, high];
    expect(normalizedSessionMetric("sizeGrad", sessions, low)).toBe(0);
    expect(normalizedSessionMetric("sizeGrad", sessions, high)).toBe(1);
    expect(normalizedSessionMetric("sizeGrad", sessions, mid)).toBeCloseTo((50 - 5) / (100 - 5));
  });

  it("normalizedSessionMetric (timeGrad): most recent normalizes to 1, oldest to 0", () => {
    const oldest = sessionWith("oldest", { startedAt: "2026-06-01T00:00:00Z" });
    const newest = sessionWith("newest", { startedAt: "2026-06-20T00:00:00Z" });
    const sessions = [oldest, newest];
    expect(normalizedSessionMetric("timeGrad", sessions, oldest)).toBe(0);
    expect(normalizedSessionMetric("timeGrad", sessions, newest)).toBe(1);
  });

  it("normalizedSessionMetric (durationGrad): longest session normalizes to 1, shortest to 0", () => {
    const short = sessionWith("short", { startedAt: "2026-06-20T10:00:00Z", endedAt: "2026-06-20T10:05:00Z" });
    const long = sessionWith("long", { startedAt: "2026-06-20T10:00:00Z", endedAt: "2026-06-20T12:00:00Z" });
    const sessions = [short, long];
    expect(normalizedSessionMetric("durationGrad", sessions, short)).toBe(0);
    expect(normalizedSessionMetric("durationGrad", sessions, long)).toBe(1);
  });

  it("normalizedSessionMetric falls back to the midpoint (0.5) when every session ties on the metric", () => {
    const a = sessionWith("a", { messageCount: 10 });
    const b = sessionWith("b", { messageCount: 10 });
    expect(normalizedSessionMetric("sizeGrad", [a, b], a)).toBe(0.5);
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

  it("CR-UI-35: memory-desc/memory-asc sort by memoryTouchCount", () => {
    const sessions: Session[] = [
      { ...makeVariedSessions()[0], id: "a", memoryTouchCount: 3 },
      { ...makeVariedSessions()[1], id: "b", memoryTouchCount: 1 },
      { ...makeVariedSessions()[2], id: "c", memoryTouchCount: 7 },
    ];
    expect(sortSessions(sessions, "memory-desc").map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(sortSessions(sessions, "memory-asc").map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("CR-UI-35: tools-desc/tools-asc sort by toolResultCount", () => {
    const sessions: Session[] = [
      { ...makeVariedSessions()[0], id: "a", toolResultCount: 2 },
      { ...makeVariedSessions()[1], id: "b", toolResultCount: 9 },
      { ...makeVariedSessions()[2], id: "c", toolResultCount: 0 },
    ];
    expect(sortSessions(sessions, "tools-desc").map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(sortSessions(sessions, "tools-asc").map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("CR-UI-35: messages-desc/messages-asc sort by messageCount", () => {
    const sessions: Session[] = [
      { ...makeVariedSessions()[0], id: "a", messageCount: 40 },
      { ...makeVariedSessions()[1], id: "b", messageCount: 5 },
      { ...makeVariedSessions()[2], id: "c", messageCount: 100 },
    ];
    expect(sortSessions(sessions, "messages-desc").map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(sortSessions(sessions, "messages-asc").map((s) => s.id)).toEqual(["b", "a", "c"]);
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
