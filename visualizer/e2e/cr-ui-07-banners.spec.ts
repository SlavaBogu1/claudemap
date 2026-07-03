import { test, expect } from "@playwright/test";
import { makeProject, mockApi, clickGraphNode, clickBanner, makeSessionDetail, type MockSession } from "./fixtures";

// CR-UI-07 acceptance criteria (VZ-3.12/3.13): always-visible ★/◆/⚙ banners with correct (incl.
// zero) counts, independent per-type expand/collapse, session-body click no longer expands, and the
// "Show session banners" Preferences toggle. All against a mocked API — never a live Indexer.

function realDataShapedSessions(): MockSession[] {
  // A deliberately varied, "real data shaped" set: some sessions with all three counts populated,
  // one with all zero, one with only one populated — per VZ-3.12/3.13's "real-data-shaped test".
  return [
    {
      id: "s-populated",
      startedAt: "2026-06-21T09:20:00Z",
      endedAt: "2026-06-21T10:00:00Z",
      messageCount: 40,
      gitBranch: "main",
      preview: "populated session",
      subagentCount: 10,
      touchedMemory: true,
      memoryTouchCount: 2,
      toolResultCount: 2,
    },
    {
      id: "s-zero",
      startedAt: "2026-06-27T22:39:00Z",
      endedAt: "2026-06-27T23:00:00Z",
      messageCount: 5,
      gitBranch: "main",
      preview: "zero-count session",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-partial",
      startedAt: "2026-06-24T12:00:00Z",
      endedAt: "2026-06-24T12:30:00Z",
      messageCount: 12,
      gitBranch: "main",
      preview: "partial session",
      subagentCount: 0,
      touchedMemory: true,
      memoryTouchCount: 3,
      toolResultCount: 0,
    },
  ];
}

function bannerLocator(
  page: import("@playwright/test").Page,
  sessionId: string,
  banner: "memory" | "subagent" | "tool",
) {
  return page.locator(
    `[data-testid="session-banner-row"][data-session-id="${sessionId}"] [data-banner="${banner}"]`,
  );
}

test.describe("CR-UI-07 — always-visible session summary banners", () => {
  test("every session shows all three banners with correct counts, including 0, against varied mocked data", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: realDataShapedSessions() },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");

    await expect(bannerLocator(page, "s-populated", "memory")).toHaveText("★ 2");
    await expect(bannerLocator(page, "s-populated", "subagent")).toHaveText("◆ 10");
    await expect(bannerLocator(page, "s-populated", "tool")).toHaveText("⚙ 2");

    await expect(bannerLocator(page, "s-zero", "memory")).toHaveText("★ 0");
    await expect(bannerLocator(page, "s-zero", "subagent")).toHaveText("◆ 0");
    await expect(bannerLocator(page, "s-zero", "tool")).toHaveText("⚙ 0");

    await expect(bannerLocator(page, "s-partial", "memory")).toHaveText("★ 3");
    await expect(bannerLocator(page, "s-partial", "subagent")).toHaveText("◆ 0");
    await expect(bannerLocator(page, "s-partial", "tool")).toHaveText("⚙ 0");
  });

  test("clicking ★ adds only memory-touch children; clicking again removes only those", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = realDataShapedSessions();
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: Array.from({ length: 2 }, (_, i) => ({
        agentId: `a${i}`,
        agentType: "general-purpose",
        description: "sub",
      })),
      memoryTouches: [{ filePath: "memory/a.md", name: "a.md" }, { filePath: "memory/b.md", name: "b.md" }],
      overflows: [{ toolUseId: "t1", filePath: "overflow/t1.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");

    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // + 2 memory only

    const counts = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return {
        memory: cy.nodes('[type = "memory"]').length,
        subagent: cy.nodes('[type = "subagent"]').length,
        tool: cy.nodes('[type = "tool"]').length,
      };
    });
    expect(counts).toEqual({ memory: 2, subagent: 0, tool: 0 });

    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");
  });

  test("clicking ◆ and ⚙ independently toggle only their own type", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = realDataShapedSessions();
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      overflows: [{ toolUseId: "t1", filePath: "overflow/t1.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await clickBanner(page, target.id, "subagent");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");

    // Collapsing subagent leaves the tool child untouched.
    await clickBanner(page, target.id, "subagent");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");
    const counts = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return {
        subagent: cy.nodes('[type = "subagent"]').length,
        tool: cy.nodes('[type = "tool"]').length,
      };
    });
    expect(counts).toEqual({ subagent: 0, tool: 1 });
  });

  test("clicking the session body updates the detail panel but adds/removes no child nodes", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = realDataShapedSessions();
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("session-preview")).toHaveText(target.preview);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");
  });

  test('toggling "Show session banners" off hides the row on every node, on restores it, persists across reload', async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: realDataShapedSessions() },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("session-banner-row").first()).toBeVisible();

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/show session banners/i).uncheck();
    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.getByTestId("session-banner-row")).toHaveCount(0);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/show session banners/i).check();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("session-banner-row").first()).toBeVisible();

    // Persists across reload.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/show session banners/i).uncheck();
    await page.getByRole("button", { name: "Close" }).click();
    await page.reload();
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("session-banner-row")).toHaveCount(0);
  });
});
