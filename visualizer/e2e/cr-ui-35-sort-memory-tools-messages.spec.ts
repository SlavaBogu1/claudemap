import { test, expect } from "@playwright/test";
import { makeProject, mockApi, type MockSession } from "./fixtures";

// CR-UI-35 acceptance criteria: Sort dropdown gains 6 new options (Memory/Tools/Message count x2),
// each sorting correctly; the dropdown shows 10 total options; CR-UI-23's disabled-outside-
// Hierarchical behavior applies to the new options too. All against a mocked API — never a live
// Indexer server.

function distinctMetricSessions(): MockSession[] {
  return [
    {
      id: "s-mid",
      startedAt: "2026-06-22T10:00:00Z",
      endedAt: "2026-06-22T10:30:00Z",
      messageCount: 50,
      gitBranch: "main",
      preview: "mid",
      subagentCount: 0,
      touchedMemory: true,
      memoryTouchCount: 3,
      toolResultCount: 2,
    },
    {
      id: "s-low",
      startedAt: "2026-06-20T10:00:00Z",
      endedAt: "2026-06-20T10:30:00Z",
      messageCount: 5,
      gitBranch: "main",
      preview: "low",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-high",
      startedAt: "2026-06-25T10:00:00Z",
      endedAt: "2026-06-25T10:30:00Z",
      messageCount: 200,
      gitBranch: "main",
      preview: "high",
      subagentCount: 0,
      touchedMemory: true,
      memoryTouchCount: 7,
      toolResultCount: 9,
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

test.describe("CR-UI-35 — Sort: Memory/Tools/Message count", () => {
  test("Sort dropdown shows 10 total options", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: distinctMetricSessions() } });

    await page.goto("/");
    const optionTexts = await page.getByLabel("Sort", { exact: true }).locator("option").allTextContents();
    expect(optionTexts).toEqual([
      "Date (newest first)",
      "Date (oldest first)",
      "Agent count (most first)",
      "Agent count (fewest first)",
      "Memory count (most first)",
      "Memory count (fewest first)",
      "Tools count (most first)",
      "Tools count (fewest first)",
      "Message count (most first)",
      "Message count (fewest first)",
    ]);
  });

  test("Memory count (most first) orders sessions by memoryTouchCount descending", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: distinctMetricSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("memory-desc");

    const positions = await sessionXPositions(page);
    expect(positions["s-high"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-low"]);
  });

  test("Tools count (fewest first) orders sessions by toolResultCount ascending", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: distinctMetricSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("tools-asc");

    const positions = await sessionXPositions(page);
    expect(positions["s-low"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-high"]);
  });

  test("Message count (most first) orders sessions by messageCount descending", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: distinctMetricSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("messages-desc");

    const positions = await sessionXPositions(page);
    expect(positions["s-high"]).toBeLessThan(positions["s-mid"]);
    expect(positions["s-mid"]).toBeLessThan(positions["s-low"]);
  });

  test("CR-UI-23 regression: the new options are disabled outside Hierarchical, same as the existing ones", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: distinctMetricSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("memory-desc");
    await expect(page.getByLabel("Sort", { exact: true })).toBeEnabled();

    await page.getByLabel("Layout").selectOption("cose");
    await expect(page.getByLabel("Sort", { exact: true })).toBeDisabled();

    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByLabel("Sort", { exact: true })).toBeDisabled();

    await page.getByLabel("Layout").selectOption("breadthfirst");
    await expect(page.getByLabel("Sort", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("memory-desc"); // preserved
  });

  test("the selected sort persists via localStorage and syncs with Preferences' Default sort", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: distinctMetricSessions() } });

    await page.goto("/");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("tools-desc");

    await page.reload();
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("tools-desc");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/default sort/i)).toHaveValue("tools-desc");
  });
});
