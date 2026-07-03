import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickBanner, dragGraphNode, makeSessionDetail } from "./fixtures";

// CR-UI-09 acceptance criteria (VZ-3.4/3.5): drill-down children in Timeline mode must never
// overlap, at any child count, and the radius must have a sensible minimum for 1-2 children.
// All against a mocked API — never a live Indexer server.

async function childPositions(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy
      .nodes('[parentSessionId]')
      .map((n: import("cytoscape").NodeSingular) => n.position());
  });
}

function minPairwiseDistance(points: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (dist < min) min = dist;
    }
  }
  return min;
}

test.describe("CR-UI-09 — Timeline drill-down child overlap fix", () => {
  test("a session with 10 mixed children in Timeline mode renders all 10 with no overlap", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: Array.from({ length: 4 }, (_, i) => ({
        agentId: `a${i}`,
        agentType: "general-purpose",
        description: `sub ${i}`,
      })),
      memoryTouches: Array.from({ length: 3 }, (_, i) => ({
        filePath: `memory/topic${i}.md`,
        name: `topic${i}.md`,
      })),
      overflows: Array.from({ length: 3 }, (_, i) => ({
        toolUseId: `tool${i}`,
        filePath: `overflow/tool${i}.txt`,
      })),
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");

    // CR-UI-07 (Sprint 3): drill-down is now exclusively a per-banner action.
    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "14"); // project + 3 sessions + 10 children

    const positions = await childPositions(page);
    expect(positions).toHaveLength(10);
    expect(minPairwiseDistance(positions)).toBeGreaterThan(20);
  });

  test("a session with only 1-2 children still renders them clearly separated", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/topic.md", name: "topic.md" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");

    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // project + 3 sessions + 2 children
    const positions = await childPositions(page);
    expect(positions).toHaveLength(2);
    expect(minPairwiseDistance(positions)).toBeGreaterThan(20);

    const sessionPos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).position();
    }, target.id);
    for (const p of positions) {
      expect(Math.hypot(p.x - sessionPos.x, p.y - sessionPos.y)).toBeGreaterThan(20);
    }
  });

  test("switching from Timeline to Force-directed re-renders an expanded session's children without re-clicking", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/topic.md", name: "topic.md" }],
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
    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "7");

    await page.getByLabel("Layout").selectOption("cose");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "cose");
    // Still expanded, no re-click needed — node count unchanged, all children still rendered.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "7");
    const positions = await childPositions(page);
    expect(positions).toHaveLength(3);
  });

  test("CR-UI-09 (reopen): dragging a session then expanding its drill-down clusters children near the dragged position, not the stale pre-drag one", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/topic.md", name: "topic.md" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");

    const originalPos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).position();
    }, target.id);

    await dragGraphNode(page, target.id, 300, 220);

    const draggedPos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).position();
    }, target.id);
    // Sanity: the drag actually moved the node meaningfully in model space.
    expect(Math.hypot(draggedPos.x - originalPos.x, draggedPos.y - originalPos.y)).toBeGreaterThan(80);

    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // project + 3 sessions + 2 children

    const positions = await childPositions(page);
    expect(positions).toHaveLength(2);

    // Every child clusters closer to the session's CURRENT (dragged) position than to its stale
    // pre-drag one — the CR-UI-09 (reopen) root cause was resolving parentPos from
    // computeTimelinePositions (pre-drag) instead of the node's live position.
    for (const p of positions) {
      const distFromDragged = Math.hypot(p.x - draggedPos.x, p.y - draggedPos.y);
      const distFromOriginal = Math.hypot(p.x - originalPos.x, p.y - originalPos.y);
      expect(distFromDragged).toBeLessThan(distFromOriginal);
    }
  });
});
