import { test, expect } from "@playwright/test";
import {
  makeProject,
  mockApi,
  clickGraphNode,
  clickBanner,
  dragGraphNode,
  makeSessionDetail,
  type MockSession,
} from "./fixtures";

// CR-UI-07 acceptance criteria (VZ-3.12/3.13): always-visible ★/◆/⚙ banners with correct (incl.
// zero) counts, independent per-type expand/collapse, and the "Show session banners" Preferences
// toggle. All against a mocked API — never a live Indexer.
//
// CR-UI-07 (reopen, Sprint 4, VZ-4.7/4.8): two unrelated fixes bundled under the same CR —
// (1) session-body-click expand-all/collapse-all restored as an ADDITION alongside the still-
// independent per-banner toggles below (Sprint 3 had made body-click selection-only); (2) the
// banner row overlay is now clipped to `.graph-canvas-wrapper` so it can't visually bleed past the
// canvas boundary into the Detail panel near an edge.

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
      // CR-UI-07 (reopened 2026-07-04): "partial" case per the reopened spec's example — Memory +
      // Tool present, Subagent absent (0) — distinct from the single-type-only case this session
      // used to represent.
      id: "s-partial",
      startedAt: "2026-06-24T12:00:00Z",
      endedAt: "2026-06-24T12:30:00Z",
      messageCount: 12,
      gitBranch: "main",
      preview: "partial session",
      subagentCount: 0,
      touchedMemory: true,
      memoryTouchCount: 3,
      toolResultCount: 2,
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
  test("a session shows only the banners whose count is > 0 — all-zero shows no row, partial shows exactly its populated types, against varied mocked data", async ({
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

    // Fully populated: all three banners render with correct counts.
    await expect(bannerLocator(page, "s-populated", "memory")).toHaveText("★ 2");
    await expect(bannerLocator(page, "s-populated", "subagent")).toHaveText("◆ 10");
    await expect(bannerLocator(page, "s-populated", "tool")).toHaveText("⚙ 2");

    // CR-UI-07 (reopened 2026-07-04): all-zero renders NO banner row at all — inverted from the
    // original "always show with 0" assertion.
    await expect(page.locator('[data-testid="session-banner-row"][data-session-id="s-zero"]')).toHaveCount(0);

    // Partial (Memory + Tool present, Subagent absent): exactly those two banners render, the
    // absent one is not in the DOM at all (not just empty/hidden).
    await expect(bannerLocator(page, "s-partial", "memory")).toHaveText("★ 3");
    await expect(bannerLocator(page, "s-partial", "tool")).toHaveText("⚙ 2");
    await expect(bannerLocator(page, "s-partial", "subagent")).toHaveCount(0);
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

  test("CR-UI-07 (reopen) — inverted: clicking the session body updates the detail panel AND toggles expand-all/collapse-all", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = realDataShapedSessions();
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/a.md", name: "a.md" }],
      overflows: [{ toolUseId: "t1", filePath: "overflow/t1.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Timeline mode keeps drill-down children well clear of the session's own footprint (a fixed
    // y-offset row below it) — deterministic, unlike the default force-directed layout where a
    // freshly-added child could physically land on top of the session node and steal the second
    // click below.
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");

    await clickGraphNode(page, target.id);
    // CR-UI-26 (Sprint 5): "session-preview" now shows the item's note (or "no notes"), not
    // session.preview.
    await expect(page.getByTestId("session-preview")).toHaveText("This item has no notes.");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "7"); // +1 each type

    // Clicking the body again collapses all 3 back to baseline.
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");
  });

  test("CR-UI-07 (reopen): body-click after a single banner expansion fills in the remaining types", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = realDataShapedSessions();
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/a.md", name: "a.md" }],
      overflows: [{ toolUseId: "t1", filePath: "overflow/t1.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Timeline mode: see the note in the previous test — keeps the freshly-added memory child from
    // physically overlapping the session node before the body click below.
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");

    // Expand only memory via its own banner.
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5");

    // Body click fills in the remaining two (subagent + tool) — memory stays expanded, not toggled.
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "7");
    const counts = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return {
        memory: cy.nodes('[type = "memory"]').length,
        subagent: cy.nodes('[type = "subagent"]').length,
        tool: cy.nodes('[type = "tool"]').length,
      };
    });
    expect(counts).toEqual({ memory: 1, subagent: 1, tool: 1 });
  });

  test("CR-UI-07 (reopen): a single-banner click after a body-click expand-all still toggles only its own type", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = realDataShapedSessions();
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/a.md", name: "a.md" }],
      overflows: [{ toolUseId: "t1", filePath: "overflow/t1.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    // Expand all 3 via the body.
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "7");

    // A follow-up single-banner click (memory) collapses only its own type, leaving the other two.
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");
    const counts = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return {
        memory: cy.nodes('[type = "memory"]').length,
        subagent: cy.nodes('[type = "subagent"]').length,
        tool: cy.nodes('[type = "tool"]').length,
      };
    });
    expect(counts).toEqual({ memory: 0, subagent: 1, tool: 1 });
  });

  test("CR-UI-07 (reopen): a session's banner row never visually bleeds past the canvas wrapper's bounds near the edge", async ({
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

    // Direct regression check for the specific fix (App.css:10).
    const overflow = await page
      .locator(".graph-canvas-wrapper")
      .evaluate((el) => getComputedStyle(el).overflow);
    expect(overflow).toBe("hidden");

    const wrapperBox = await page.locator(".graph-canvas-wrapper").boundingBox();
    if (!wrapperBox) throw new Error("graph canvas wrapper not found");

    // Drag a session node hard toward the canvas's right edge, close enough that its banner row
    // (transform: translate(-50%, -100%), wider than the node itself) would bleed past the wrapper
    // without the `overflow: hidden` fix.
    const nodePos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).renderedPosition();
    }, "s-populated");
    const targetX = wrapperBox.width - 15;
    await dragGraphNode(page, "s-populated", targetX - nodePos.x, 0);

    const rowBox = await page
      .locator('[data-testid="session-banner-row"][data-session-id="s-populated"]')
      .boundingBox();
    if (!rowBox) throw new Error("banner row not found");

    // Sanity: this drag scenario actually creates overflow that needs clipping — the banner row's
    // own (un-clipped-by-definition) layout box extends past the wrapper's right edge. Without this
    // check the test below would trivially pass without exercising the fix at all: a DOM element's
    // `getBoundingClientRect()` reflects its own layout geometry regardless of an ancestor's
    // `overflow: hidden`, which only affects painting/hit-testing — not the reported box.
    expect(rowBox.x + rowBox.width).toBeGreaterThan(wrapperBox.x + wrapperBox.width);

    // The overflowing portion is visually/interactively clipped: hit-testing a point just past the
    // wrapper's right edge — squarely inside the banner row's un-clipped layout box — resolves to
    // whatever's actually painted there, not the banner overlay.
    const probeX = wrapperBox.x + wrapperBox.width + 5;
    const probeY = rowBox.y + rowBox.height / 2;
    const hitIsBanner = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".session-banner-row"),
      { x: probeX, y: probeY },
    );
    expect(hitIsBanner).toBe(false);
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
    // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
    await page.getByRole("button", { name: "Menu" }).click();

    await expect(page.getByTestId("session-banner-row")).toHaveCount(0);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/show session banners/i).check();
    // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByTestId("session-banner-row").first()).toBeVisible();

    // Persists across reload.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/show session banners/i).uncheck();
    // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.reload();
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("session-banner-row")).toHaveCount(0);
  });
});
