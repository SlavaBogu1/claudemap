import { test, expect } from "@playwright/test";
import { makeProject, mockApi, type MockSession } from "./fixtures";

// CR-UI-10 acceptance criteria (VZ-3.8/3.9), all against a mocked API — never a live Indexer server.

function variedSessions(): MockSession[] {
  return [
    {
      id: "s-mid",
      startedAt: "2026-06-22T10:00:00Z",
      endedAt: "2026-06-22T10:30:00Z",
      messageCount: 5,
      gitBranch: "main",
      preview: "mid session",
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
      preview: "early session",
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
      preview: "late session",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
  ];
}

async function sessionXPositions(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const result: Record<string, number> = {};
    cy.nodes('[type = "session"]').forEach((n: import("cytoscape").NodeSingular) => {
      result[n.id()] = n.position().x;
    });
    return result;
  });
}

test.describe("CR-UI-10 — session sort control", () => {
  test("Date (newest first) in Hierarchical mode orders sessions left-to-right by descending startedAt", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: variedSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("date-desc");

    const positions = await sessionXPositions(page);
    expect(positions["s-late"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-early"]);
  });

  test("Agent count (most first) orders sessions by subagentCount descending", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: variedSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("agents-desc");

    const positions = await sessionXPositions(page);
    // s-early (5 subagents) first, s-mid (2) next, s-late (0) last.
    expect(positions["s-early"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-late"]);
  });

  test("changing sort triggers no additional network request", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: variedSessions() },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Polled rather than a bare synchronous read: the sessions fetch is fired from a React effect
    // after selectOption's promise resolves, so under heavier parallel-worker load the request may
    // not have landed yet at this exact tick (same hardening already applied in
    // cr-ui-05-timeline.spec.ts's "switching to/from Timeline" test).
    await expect.poll(() => handle.sessionsRequestCount["sudoku"]).toBe(1);

    // CR-UI-23: the header Sort control is only interactive in Hierarchical mode.
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("agents-desc");
    expect(handle.sessionsRequestCount["sudoku"]).toBe(1);
  });

  test("sort persists via Preferences and survives a layout switch", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: variedSessions() } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/default sort/i).selectOption("agents-asc");
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload();
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("agents-asc");

    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    let positions = await sessionXPositions(page);
    expect(positions["s-late"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-early"]);

    // Switching layout preserves the active sort choice (orthogonal settings).
    await page.getByLabel("Layout").selectOption("timeline");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("agents-asc");
    positions = await sessionXPositions(page);
    expect(positions["s-late"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-early"]);
  });

  test("setting sort via either control (header or Preferences) updates the other", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: variedSessions() } });

    await page.goto("/");

    // CR-UI-23: the header Sort control is only interactive in Hierarchical mode.
    await page.getByLabel("Layout").selectOption("breadthfirst");

    // Header -> Preferences.
    await page.getByLabel("Sort", { exact: true }).selectOption("agents-desc");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/default sort/i)).toHaveValue("agents-desc");

    // Preferences -> header.
    await page.getByLabel(/default sort/i).selectOption("date-asc");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("date-asc");
  });
});
