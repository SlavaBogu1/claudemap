import type { Session, TimeRangeName } from "../types";

// CR-UI-27 (Sprint 6): pure, unit-testable filter — no Cytoscape/DOM involved, applied to `sessions`
// in App.tsx before sort/layout. Accepts `now` as an optional param (defaulting to the real current
// time) so tests can pass a fixed reference date instead of depending on the real clock.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function filterSessionsByTimeRange(
  sessions: Session[],
  range: TimeRangeName,
  now: Date = new Date(),
): Session[] {
  if (range === "all") return sessions;
  const cutoffMs = now.getTime() - (range === "week" ? WEEK_MS : MONTH_MS);
  return sessions.filter((s) => {
    const t = new Date(s.startedAt).getTime();
    return !Number.isNaN(t) && t >= cutoffMs;
  });
}
