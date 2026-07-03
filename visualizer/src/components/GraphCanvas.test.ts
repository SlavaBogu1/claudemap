import { describe, it, expect } from "vitest";
import { buildGraphElements } from "./GraphCanvas";
import type { Project, Session } from "../types";

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
