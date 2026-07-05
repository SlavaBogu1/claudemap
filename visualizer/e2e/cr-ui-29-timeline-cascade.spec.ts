import { test, expect } from "@playwright/test";
import {
  makeProject,
  mockApi,
  clickBanner,
  makeSessionDetail,
  waitForNextLayoutRun,
  type MockSession,
} from "./fixtures";

// CR-UI-29 acceptance criteria: same-day sessions cascade-stack (day-baseline + incremental X/Y/
// Z-index) per the approved mockup (docs/mockups/timeline-cascade-stack.png), replacing the old flat
// same-timestamp jitter. All against a mocked API — never a live Indexer server.

function sessionAt(id: string, startedAt: string, overrides: Partial<MockSession> = {}): MockSession {
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
    ...overrides,
  };
}

async function nodePosition(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((nodeId) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy.getElementById(nodeId).position();
  }, id);
}

async function nodeZIndex(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((nodeId) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy.getElementById(nodeId).style("z-index");
  }, id);
}

test.describe("CR-UI-29 — Timeline cascade-stack", () => {
  test("N=15 same-day sessions cascade uncapped with incremental offsets and strictly increasing z-index", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 15 });
    const sessions = Array.from({ length: 15 }, (_, i) =>
      sessionAt(`s${i}`, `2026-06-20T${String(6 + i).padStart(2, "0")}:00:00Z`),
    );
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");

    let prevPos = await nodePosition(page, "s0");
    let prevZ = Number(await nodeZIndex(page, "s0"));
    for (let i = 1; i < 15; i++) {
      const pos = await nodePosition(page, `s${i}`);
      const z = Number(await nodeZIndex(page, `s${i}`));
      expect(pos.y).toBeGreaterThan(prevPos.y);
      expect(z).toBeGreaterThan(prevZ);
      prevPos = pos;
      prevZ = z;
    }
    // The day's last (most recent) session is frontmost (highest z-index among the day's sessions).
    expect(prevZ).toBe(15);
  });

  test("a day with exactly 1 session renders with no cascade offset", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = [sessionAt("solo", "2026-06-20T10:00:00Z")];
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");

    const pos = await nodePosition(page, "solo");
    // Baseline Y (TIMELINE_SESSION_Y), no cascade offset applied.
    expect(pos.y).toBe(200);
  });

  test("across 2+ distinct days, each day's earliest session shares the same baseline Y", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    const sessions = [
      sessionAt("day1-a", "2026-06-20T09:00:00Z"),
      sessionAt("day1-b", "2026-06-20T10:00:00Z"),
      sessionAt("day1-c", "2026-06-20T11:00:00Z"),
      sessionAt("day2-a", "2026-06-21T09:00:00Z"),
    ];
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");

    const day1a = await nodePosition(page, "day1-a");
    const day2a = await nodePosition(page, "day2-a");
    const day1c = await nodePosition(page, "day1-c");
    expect(day2a.y).toBe(day1a.y);
    expect(day1c.y).toBeGreaterThan(day1a.y);
  });

  test("CR-UI-07 banner pills still render correctly positioned on cascaded tiles (real-browser smoke check)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = [
      sessionAt("day1-a", "2026-06-20T09:00:00Z", { memoryTouchCount: 1 }),
      sessionAt("day1-b", "2026-06-20T10:00:00Z", { subagentCount: 2 }),
      sessionAt("day1-c", "2026-06-20T11:00:00Z", { toolResultCount: 3 }),
    ];
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");

    for (const id of ["day1-a", "day1-b", "day1-c"]) {
      const row = page.locator(`[data-testid="session-banner-row"][data-session-id="${id}"]`);
      await expect(row).toBeVisible();
    }
  });

  test("expanding a mid-cascade session positions its drill-down children relative to its own cascaded position", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = [
      sessionAt("day1-a", "2026-06-20T09:00:00Z"),
      // CR-UI-07 (reopened 2026-07-04): banners now hide entirely at count 0 — this session's
      // memory banner is clicked below via clickBanner, so it needs a nonzero memoryTouchCount to
      // render/be clickable at all.
      sessionAt("day1-b", "2026-06-20T10:00:00Z", { memoryTouchCount: 1 }),
      sessionAt("day1-c", "2026-06-20T11:00:00Z"),
    ];
    const detail = makeSessionDetail({
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { "sudoku/day1-b": detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");

    const midPos = await nodePosition(page, "day1-b");
    // CR-UI-36: wait for the expand's own layout run to finish (not an arbitrary sleep/timeout)
    // before reading the newly-added child's position — see waitForNextLayoutRun's doc comment in
    // fixtures.ts for the root-caused race this fixes (intermittent full-suite-only failure).
    await waitForNextLayoutRun(page, () => clickBanner(page, "day1-b", "memory"));

    const childPos = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes('[parentSessionId]').first().position();
    });
    const distFromMid = Math.hypot(childPos.x - midPos.x, childPos.y - midPos.y);
    const frontmostPos = await nodePosition(page, "day1-c");
    const distFromFrontmost = Math.hypot(childPos.x - frontmostPos.x, childPos.y - frontmostPos.y);
    expect(distFromMid).toBeLessThan(distFromFrontmost);
  });
});
