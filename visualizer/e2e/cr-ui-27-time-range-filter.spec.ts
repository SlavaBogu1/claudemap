import { test, expect } from "@playwright/test";
import { makeProject, mockApi, type MockSession } from "./fixtures";

// CR-UI-27 acceptance criteria: a Week/Month/All time-range filter in the header (after Sort),
// bidirectionally synced with a Preferences field, that filters rendered sessions by `startedAt`.
// All against a mocked API — never a live Indexer server. Playwright can't fake the real system
// clock cheaply, so these tests use dates relative to `new Date()` at test-run time.

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function rangedSessions(): MockSession[] {
  return [
    {
      id: "s-today",
      startedAt: daysAgoIso(0.1),
      endedAt: daysAgoIso(0.1),
      messageCount: 5,
      gitBranch: "main",
      preview: "today",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-3-days",
      startedAt: daysAgoIso(3),
      endedAt: daysAgoIso(3),
      messageCount: 5,
      gitBranch: "main",
      preview: "3 days ago",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-15-days",
      startedAt: daysAgoIso(15),
      endedAt: daysAgoIso(15),
      messageCount: 5,
      gitBranch: "main",
      preview: "15 days ago",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-60-days",
      startedAt: daysAgoIso(60),
      endedAt: daysAgoIso(60),
      messageCount: 5,
      gitBranch: "main",
      preview: "60 days ago",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
  ];
}

async function sessionNodeCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy.nodes('[type = "session"]').length;
  });
}

test.describe("CR-UI-27 — Time-range filter", () => {
  test("the Time range control appears in the header immediately after Sort", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: rangedSessions() } });

    await page.goto("/");
    const header = page.locator(".app-header");
    const controlTexts = await header
      .locator(".sort-switcher, .time-range-switcher")
      .evaluateAll((els) => els.map((el) => el.className));
    expect(controlTexts).toEqual(["sort-switcher", "time-range-switcher"]);
  });

  test('"Week" shows only sessions from the last 7 days', async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: rangedSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect.poll(() => sessionNodeCount(page)).toBe(4);

    await page.getByLabel("Time range", { exact: true }).selectOption("week");
    await expect.poll(() => sessionNodeCount(page)).toBe(2);
  });

  test('"Month" shows only sessions from the last 30 days', async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: rangedSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Time range", { exact: true }).selectOption("month");
    await expect.poll(() => sessionNodeCount(page)).toBe(3);
  });

  test('"All" (default) shows every session', async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: rangedSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByLabel("Time range", { exact: true })).toHaveValue("all");
    await expect.poll(() => sessionNodeCount(page)).toBe(4);
  });

  test("a project with zero sessions in the selected range shows the project node alone with a clear hint", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: [rangedSessions()[3]] }, // only the 60-days-ago session
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Time range", { exact: true }).selectOption("week");

    await expect(page.getByTestId("time-range-empty-hint")).toBeVisible();
    await expect.poll(() => sessionNodeCount(page)).toBe(0);
    // The project node itself is still there.
    const projectNodeCount = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes('[type = "project"]').length;
    });
    expect(projectNodeCount).toBe(1);
  });

  test("the chosen range persists via localStorage and syncs with the Preferences field", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: rangedSessions() } });

    await page.goto("/");
    await page.getByLabel("Time range", { exact: true }).selectOption("week");
    await page.reload();
    await expect(page.getByLabel("Time range", { exact: true })).toHaveValue("week");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/default time range/i)).toHaveValue("week");

    await page.getByLabel(/default time range/i).selectOption("month");
    // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByLabel("Time range", { exact: true })).toHaveValue("month");
  });

  test("switching time range does not force-clear an existing session selection", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: rangedSessions() },
      sessionContentByKey: { "sudoku/s-60-days": { messages: [] } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    const box = await page.locator(".graph-canvas-wrapper").boundingBox();
    if (!box) throw new Error("no canvas");
    const pos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).renderedPosition();
    }, "s-60-days");
    await page.mouse.click(box.x + pos.x, box.y + pos.y);
    await expect(page.getByTestId("session-detail")).toBeVisible();

    // Filtering it out of view doesn't clear the Detail panel's selection.
    await page.getByLabel("Time range", { exact: true }).selectOption("week");
    await expect(page.getByTestId("session-detail")).toBeVisible();
  });

  test("filter-then-sort: a non-'All' range combined with a non-default sort still sorts correctly", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 4 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: rangedSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Time range", { exact: true }).selectOption("month"); // excludes s-60-days
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("date-asc");

    const positions = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      const result: Record<string, number> = {};
      cy.nodes('[type = "session"]').forEach((n: import("cytoscape").NodeSingular) => {
        result[n.id()] = n.position().x;
      });
      return result;
    });
    expect(Object.keys(positions).sort()).toEqual(["s-15-days", "s-3-days", "s-today"].sort());
    expect(positions["s-15-days"]).toBeLessThan(positions["s-3-days"]);
    expect(positions["s-3-days"]).toBeLessThan(positions["s-today"]);
  });
});
