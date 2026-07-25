import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-40 acceptance criteria: a Preferences toggle ("Require double-click to expand/collapse")
// gates the session-body-click expand/collapse-all gesture (CR-UI-07) behind a double-click
// (Cytoscape's native `dbltap`) instead of a single click, while single-click selection always
// still fires. Default off preserves today's exact single-click-does-both behavior. All against a
// mocked API — never a live Indexer server.

async function enableDoubleClickPreference(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await page.getByLabel(/require double-click to expand\/collapse/i).check();
  // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
  await page.getByRole("button", { name: "Menu" }).click();
}

// Cytoscape's own gesture recognition (not the browser's native `dblclick` event) drives `dbltap` —
// two real mousedown/mouseup sequences at the same rendered position, fired close enough together
// to land inside Cytoscape's default double-tap interval.
async function doubleClickGraphNode(page: import("@playwright/test").Page, nodeId: string): Promise<void> {
  const canvasWrapper = page.locator(".graph-canvas-wrapper");
  const box = await canvasWrapper.boundingBox();
  if (!box) throw new Error("graph canvas wrapper not found");
  const pos = await page.evaluate((id) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy.getElementById(id).renderedPosition();
  }, nodeId);
  const x = box.x + pos.x;
  const y = box.y + pos.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("CR-UI-40 — Preferences: require double-click to expand/collapse", () => {
  test("Preferences shows the 'Require double-click to expand/collapse' checkbox, unchecked by default", async ({
    page,
  }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/require double-click to expand\/collapse/i)).not.toBeChecked();
  });

  test("preference off (default): a single click on a session body selects it AND toggles expand/collapse-all — byte-for-byte unchanged from today", async ({
    page,
  }) => {
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
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("session-preview")).toBeVisible();
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("preference on: a single click on a session body selects it only — no expand/collapse", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "code-review", description: "x" }],
    });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");
    await enableDoubleClickPreference(page);

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("session-preview")).toBeVisible();
    // No new drill-down children — selection only.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("preference on: a double-click on a session body triggers expand-all/collapse-all", async ({
    page,
  }) => {
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
    await page.getByLabel("Layout").selectOption("timeline");
    await enableDoubleClickPreference(page);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    await doubleClickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");

    // A second double-click collapses back to baseline.
    await doubleClickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("regression: per-banner single-type toggles are unaffected by the preference in either mode", async ({
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
    await enableDoubleClickPreference(page);

    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "3");
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("regression: Space-key expand/collapse-all for the keyboard-focused session works identically with the preference on", async ({
    page,
  }) => {
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
    await enableDoubleClickPreference(page);

    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", /\d+/);
    await page.locator(".graph-canvas-wrapper").focus();
    await page.keyboard.press("Tab"); // moves to the (only) session

    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
    await page.keyboard.press(" ");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");
    await page.keyboard.press(" ");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("toggling the preference takes effect immediately (no reload) and persists across a reload", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "code-review", description: "x" }],
    });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");
    await enableDoubleClickPreference(page);

    // Takes effect immediately, no reload yet.
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    await page.reload();
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/require double-click to expand\/collapse/i)).toBeChecked();
  });
});
