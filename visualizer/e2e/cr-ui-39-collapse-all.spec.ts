import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-39 acceptance criteria: a "Collapse All" burger-menu item resets every session's expanded
// drill-down children across the whole graph in one action. All against a mocked API — never a
// live Indexer server.

async function nodeCount(page: import("@playwright/test").Page): Promise<number> {
  return Number(await page.getByTestId("graph-status").getAttribute("data-node-count"));
}

async function clickCollapseAll(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Collapse All" }).click();
}

test.describe("CR-UI-39 — Collapse All burger-menu action", () => {
  test("with 3+ sessions expanded via a mix of per-banner and body-click expansion, Collapse All collapses every session's drill-down children in one action", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    const sessions = makeSessions(5);
    const detailFor = (id: string) =>
      makeSessionDetail({
        subagents: [{ agentId: `a-${id}`, agentType: "code-review", description: "x" }],
        memoryTouches: [{ filePath: `memory/${id}.md`, name: `${id}.md` }],
        overflows: [{ toolUseId: `tool-${id}`, filePath: `overflow/${id}.txt` }],
      });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: {
        [`sudoku/${sessions[0].id}`]: detailFor(sessions[0].id),
        [`sudoku/${sessions[1].id}`]: detailFor(sessions[1].id),
        [`sudoku/${sessions[2].id}`]: detailFor(sessions[2].id),
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Timeline mode keeps drill-down children clear of session nodes, same reasoning as
    // cr-ui-06-drilldown.spec.ts's body-click test — deterministic clicking of multiple sessions.
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // project + 5 sessions

    // Session 0: expand via a mix of per-banner clicks.
    await clickBanner(page, sessions[0].id, "subagent");
    await clickBanner(page, sessions[0].id, "memory");
    // Session 1: expand via body-click (expand-all).
    await clickGraphNode(page, sessions[1].id);
    // Session 2: expand via body-click too, a third expanded session.
    await clickGraphNode(page, sessions[2].id);

    // 2 (session 0, partial) + 3 (session 1, all types) + 3 (session 2, all types) = 8 extra nodes.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "14");

    await clickCollapseAll(page);

    // Back to project + 5 sessions only — zero drill-down child nodes remain.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");
    const counts = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return {
        subagent: cy.nodes('[type = "subagent"]').length,
        memory: cy.nodes('[type = "memory"]').length,
        tool: cy.nodes('[type = "tool"]').length,
      };
    });
    expect(counts).toEqual({ subagent: 0, memory: 0, tool: 0 });
  });

  test("the burger menu shows exactly 6 items including Collapse All as the 6th", async ({ page }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveCount(6);
    await expect(items.nth(5)).toHaveText("Collapse All");
  });

  test("Collapse All is a no-op when nothing is currently expanded", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(3) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Wait for the sessions fetch to settle before reading a stable baseline count (project + 3
    // sessions) — avoids racing the async load.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");
    const before = await nodeCount(page);

    await clickCollapseAll(page);

    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", String(before));
    await expect(page.locator(".error-text")).toHaveCount(0);
  });

  test("after collapsing, a session can be re-expanded normally via body click", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "code-review", description: "x" }],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");

    await clickCollapseAll(page);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");
  });

  test("regression: collapsing all does not affect the current selection or the Detail panel's shown data", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    const sessions = makeSessions(2);
    const target = sessions[0];
    const detail = makeSessionDetail({
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
    });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("session-preview")).toBeVisible();
    const selectedBefore = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes(".selected").first().id();
    });

    await clickCollapseAll(page);

    const selectedAfter = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes(".selected").first().id();
    });
    expect(selectedAfter).toBe(selectedBefore);
    await expect(page.getByTestId("session-preview")).toBeVisible();
  });

  test("regression: existing per-banner and body-click expand/collapse behavior is unaffected by this addition", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
    });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "3");
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });
});
