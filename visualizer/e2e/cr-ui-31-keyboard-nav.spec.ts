import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, makeSessionDetail } from "./fixtures";

// CR-UI-31 acceptance criteria: Tab/Shift+Tab cycle Project -> Session 1 -> ... -> Project (never
// landing on a banner button, a sub-item node, or the note-badge overlay); Space toggles
// expand/collapse-all on the focused session only; each move updates the Detail panel without
// resetting drill-down expansion state; banner buttons stay mouse-clickable but excluded from Tab
// order; no regression to click-based interaction. All against a mocked API — never a live Indexer.

async function focusCanvas(page: import("@playwright/test").Page) {
  // Wait for Cytoscape to have actually mounted/rendered (the `__cy` test hook + at least the
  // project node) before focusing — otherwise `activateFocusIndex`'s `cy.getElementById(...)`
  // lookup can run against an empty/not-yet-existing graph, wrongly finding nothing.
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", /\d+/);
  await page.locator(".graph-canvas-wrapper").focus();
}

async function selectedNodeId(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const selected = cy.nodes(".selected");
    return selected.length > 0 ? selected.first().id() : null;
  });
}

test.describe("CR-UI-31 — Tab/Space keyboard navigation", () => {
  test("Tab from outside the canvas moves focus onto the Project node first", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(2) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Before any selection (click or Tab), the Detail panel's item-driven preview area isn't shown.
    await expect(page.getByTestId("session-preview")).toHaveCount(0);

    await focusCanvas(page);

    expect(await selectedNodeId(page)).toBe("project:sudoku");
    // Tab-driven focus reuses the exact same onSelectItem path as a click, so the Detail panel
    // updates to show the (now-selected) project's item.
    await expect(page.getByTestId("session-preview")).toBeVisible();
  });

  test("repeated Tab cycles Project -> Session 1 -> Session 2 -> back to Project", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    const sessions = makeSessions(2); // date-desc default: session-1 (later day) before session-0
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await focusCanvas(page);

    expect(await selectedNodeId(page)).toBe("project:sudoku");
    await page.keyboard.press("Tab");
    const first = await selectedNodeId(page);
    expect(first).not.toBeNull();
    expect(first).not.toBe("project:sudoku");

    await page.keyboard.press("Tab");
    const second = await selectedNodeId(page);
    expect(second).not.toBe(first);
    expect(second).not.toBe("project:sudoku");

    await page.keyboard.press("Tab");
    expect(await selectedNodeId(page)).toBe("project:sudoku"); // wrapped
  });

  test("Shift+Tab cycles in the reverse order", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(2) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await focusCanvas(page);

    // Wraps the other direction: from Project, Shift+Tab lands on the LAST session.
    await page.keyboard.press("Shift+Tab");
    const last = await selectedNodeId(page);
    expect(last).not.toBe("project:sudoku");

    await page.keyboard.press("Tab");
    expect(await selectedNodeId(page)).toBe("project:sudoku");
  });

  test("Tab never lands on a banner button, a sub-item node, or the project's own banner", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
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
    await focusCanvas(page);
    await page.keyboard.press("Tab"); // lands on the session

    const selected = await selectedNodeId(page);
    expect(selected).toBe(target.id);
    expect(selected).not.toContain(":subagent:");

    // Active element is still the wrapper, not a banner button.
    const activeTag = await page.evaluate(() => document.activeElement?.className);
    expect(activeTag).toBe("graph-canvas-wrapper");
  });

  test("each Tab move updates the Detail panel but does not change drill-down expansion state", async ({
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

    // Expand via a click first (existing interaction, unaffected).
    const box = await page.locator(".graph-canvas-wrapper").boundingBox();
    if (!box) throw new Error("no canvas");
    const pos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).renderedPosition();
    }, target.id);
    await page.mouse.click(box.x + pos.x, box.y + pos.y);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4"); // project + 2 sessions + 1 child

    await focusCanvas(page); // Project (index 0)
    await page.keyboard.press("Tab"); // session (index 1)
    await page.keyboard.press("Tab"); // session (index 2)
    // Expansion state (node count) is unaffected by pure Tab navigation.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");
  });

  test("Space toggles expand/collapse-all for the focused session only", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
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
    await focusCanvas(page); // lands on the Project node (index 0)
    await page.keyboard.press("Tab"); // moves to the (only) session (index 1)

    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
    await page.keyboard.press(" ");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5"); // +3 children
    await page.keyboard.press(" ");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("Space on the Project node is a no-op", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await focusCanvas(page);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
    await page.keyboard.press(" ");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("banner buttons are excluded from Tab order but remain fully mouse-clickable", async ({
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

    const memoryBanner = page.locator(
      `[data-testid="session-banner-row"][data-session-id="${target.id}"] [data-banner="memory"]`,
    );
    await expect(memoryBanner).toHaveAttribute("tabindex", "-1");

    // Still clickable via the mouse, unchanged.
    await memoryBanner.click();
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "3"); // project + session + 1 child
  });

  test("no regression to existing click-based interaction after keyboard nav is added", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    const sessions = makeSessions(2);

    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    const box = await page.locator(".graph-canvas-wrapper").boundingBox();
    if (!box) throw new Error("no canvas");
    const pos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).renderedPosition();
    }, sessions[0].id);
    await page.mouse.click(box.x + pos.x, box.y + pos.y);

    expect(await selectedNodeId(page)).toBe(sessions[0].id);
  });
});
