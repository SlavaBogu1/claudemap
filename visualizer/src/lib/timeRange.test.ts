import { describe, it, expect } from "vitest";
import { filterSessionsByTimeRange } from "./timeRange";
import type { Session } from "../types";

function makeSession(id: string, startedAt: string): Session {
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

// Fixed reference "now" so tests never depend on the real clock (CR-UI-27).
const NOW = new Date("2026-07-15T12:00:00Z");

describe("filterSessionsByTimeRange (CR-UI-27)", () => {
  const sessions = [
    makeSession("today", "2026-07-15T10:00:00Z"), // 2h ago
    makeSession("3-days-ago", "2026-07-12T10:00:00Z"), // within week
    makeSession("10-days-ago", "2026-07-05T10:00:00Z"), // within month, outside week
    makeSession("25-days-ago", "2026-06-20T10:00:00Z"), // within month
    makeSession("60-days-ago", "2026-05-16T10:00:00Z"), // outside month
  ];

  it('"all" returns every session unchanged', () => {
    expect(filterSessionsByTimeRange(sessions, "all", NOW)).toEqual(sessions);
  });

  it('"week" keeps only sessions from the last 7 days', () => {
    const result = filterSessionsByTimeRange(sessions, "week", NOW);
    expect(result.map((s) => s.id)).toEqual(["today", "3-days-ago"]);
  });

  it('"month" keeps only sessions from the last 30 days', () => {
    const result = filterSessionsByTimeRange(sessions, "month", NOW);
    expect(result.map((s) => s.id)).toEqual(["today", "3-days-ago", "10-days-ago", "25-days-ago"]);
  });

  it("a session exactly at the cutoff boundary is included (inclusive >=)", () => {
    const exact = makeSession("exact-week", new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const result = filterSessionsByTimeRange([exact], "week", NOW);
    expect(result).toHaveLength(1);
  });

  it("defaults `now` to the real current time when omitted", () => {
    const recent = makeSession("just-now", new Date().toISOString());
    const result = filterSessionsByTimeRange([recent], "week");
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when nothing falls within range, without erroring", () => {
    const old = [makeSession("ancient", "2020-01-01T00:00:00Z")];
    expect(filterSessionsByTimeRange(old, "week", NOW)).toEqual([]);
  });
});
