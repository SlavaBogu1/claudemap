import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-18 acceptance criteria (VZ-4.9/4.10): the 📝 note indicator moves from an in-label suffix
// to a `.note-badge-layer` bottom-right corner badge, generalized over EVERY node type with a saved
// note (not session-only), tracking the node across pan/zoom/layout switches. All against a mocked
// API — never a live Indexer. See cr-ui-08-content-notes.spec.ts for the Save/Delete flow itself;
// this file covers the badge overlay's own rendering/positioning contract.

function badgeLocator(page: import("@playwright/test").Page, nodeId: string) {
  return page.locator(`[data-testid="note-badge"][data-node-id="${nodeId}"]`);
}

test.describe("CR-UI-18 — note corner badge", () => {
  test("labels no longer contain the 📝 suffix for any node type", async ({ page }) => {
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
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "project",
          nodeId: "sudoku",
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await clickBanner(page, target.id, "tool");

    const labels = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes().map((n: import("cytoscape").NodeSingular) => n.data("label") as string);
    });
    for (const label of labels) {
      expect(label).not.toContain("📝");
    }
  });

  test("a badge renders for a noted project node, a noted session node, and a noted drill-down child", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
    });
    const memoryNodeId = `${target.id}:memory:memory/PLAN.md`;

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "project",
          nodeId: "sudoku",
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
        {
          projectId: "sudoku",
          nodeType: "memoryTouch",
          nodeId: "memory/PLAN.md",
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(badgeLocator(page, "project:sudoku")).toBeVisible();
    await expect(badgeLocator(page, target.id)).toBeVisible();

    // Not yet on the canvas (not expanded) — no badge for the memory child yet.
    await expect(badgeLocator(page, memoryNodeId)).toHaveCount(0);

    await clickBanner(page, target.id, "memory");
    await expect(badgeLocator(page, memoryNodeId)).toBeVisible();
  });

  test("an unnoted node shows no badge", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
    await expect(page.locator('[data-testid="note-badge"]')).toHaveCount(0);
  });

  test("a badge tracks its node across pan, zoom, and a layout switch", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(badgeLocator(page, target.id)).toBeVisible();

    const wrapperBox = await page.locator(".graph-canvas-wrapper").boundingBox();
    if (!wrapperBox) throw new Error("graph canvas wrapper not found");

    // `node.renderedPosition()` is relative to the Cytoscape container's (== `.graph-canvas-wrapper`'s)
    // own top-left corner; a Playwright `boundingBox()` is relative to the page viewport — subtract
    // `wrapperBox`'s offset (constant across pan/zoom/layout, since the wrapper itself never moves)
    // to compare the two in the same coordinate space.
    async function nodeAndBadgeCanvasRelativePositions() {
      const nodePos = await page.evaluate((id) => {
        const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
        return cy.getElementById(id).renderedPosition();
      }, target.id);
      const badgeBox = await badgeLocator(page, target.id).boundingBox();
      if (!badgeBox) throw new Error("badge not found");
      const badgeCenter = {
        x: badgeBox.x + badgeBox.width / 2 - wrapperBox.x,
        y: badgeBox.y + badgeBox.height / 2 - wrapperBox.y,
      };
      return { nodePos, badgeCenter };
    }

    function expectBadgeAtNodesBottomRightCorner(result: Awaited<ReturnType<typeof nodeAndBadgeCanvasRelativePositions>>) {
      // The badge sits toward the node's bottom-right corner: strictly right of and below the
      // node's own center, but not absurdly far away (the node's rendered size, which the badge's
      // offset scales with, stays well under 200px even zoomed in). CR-UI-32 (Sprint 6) bumped
      // session node height 70 -> 82 for the label's new 3rd line, so the margin here was widened
      // from 150 to 200 to comfortably re-accommodate that (still catches a genuinely broken
      // far-away badge, just no longer flags this legitimate, intentional size increase).
      expect(result.badgeCenter.x).toBeGreaterThan(result.nodePos.x);
      expect(result.badgeCenter.y).toBeGreaterThan(result.nodePos.y);
      expect(result.badgeCenter.x - result.nodePos.x).toBeLessThan(200);
      expect(result.badgeCenter.y - result.nodePos.y).toBeLessThan(200);
    }

    const before = await nodeAndBadgeCanvasRelativePositions();
    expectBadgeAtNodesBottomRightCorner(before);

    // Pan: the badge moves by exactly the same delta as the node itself.
    await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      cy.panBy({ x: 60, y: 40 });
    });
    const afterPan = await nodeAndBadgeCanvasRelativePositions();
    expectBadgeAtNodesBottomRightCorner(afterPan);
    expect(afterPan.badgeCenter.x - before.badgeCenter.x).toBeCloseTo(
      afterPan.nodePos.x - before.nodePos.x,
      0,
    );

    // Zoom: the badge stays anchored to the node's (now differently-scaled) corner.
    await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      cy.zoom({ level: cy.zoom() * 1.5, renderedPosition: { x: 100, y: 100 } });
    });
    const afterZoom = await nodeAndBadgeCanvasRelativePositions();
    expectBadgeAtNodesBottomRightCorner(afterZoom);

    // Layout switch: still tracks correctly at the node's new position under a different algorithm.
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");
    const afterLayout = await nodeAndBadgeCanvasRelativePositions();
    expectBadgeAtNodesBottomRightCorner(afterLayout);
  });
});
