import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-13 acceptance criteria (VZ-3.2/3.3): expanding/collapsing one session's drill-down
// children must not move any other node — verified against a mocked API only, never a live
// Indexer server.

async function allNodePositions(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const result: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((n: import("cytoscape").NodeSingular) => {
      result[n.id()] = n.position();
    });
    return result;
  });
}

function expectUnrelatedNodesUnchanged(
  before: Record<string, { x: number; y: number }>,
  after: Record<string, { x: number; y: number }>,
  excludeIds: Set<string>,
) {
  for (const [id, pos] of Object.entries(before)) {
    if (excludeIds.has(id)) continue;
    expect(after[id], `node ${id} should still exist`).toBeDefined();
    expect(after[id].x, `node ${id} x should be unchanged`).toBeCloseTo(pos.x, 1);
    expect(after[id].y, `node ${id} y should be unchanged`).toBeCloseTo(pos.y, 1);
  }
}

test.describe("CR-UI-13 — expand/collapse must not reposition unrelated nodes", () => {
  for (const layout of ["cose", "breadthfirst"] as const) {
    test(`expanding a session in ${layout} mode leaves every other node's position unchanged`, async ({
      page,
    }) => {
      const project = makeProject({ id: "sudoku", sessionCount: 6 });
      const sessions = makeSessions(6);
      const target = sessions[2];
      const detail = makeSessionDetail({
        subagents: [{ agentId: "a1", agentType: "code-review", description: "reviewed the diff" }],
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
      await page.getByLabel("Layout").selectOption(layout);
      await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", layout);

      const before = await allNodePositions(page);

      // CR-UI-07 (Sprint 3): drill-down is now exclusively a per-banner action.
      await clickBanner(page, target.id, "subagent");
      await clickBanner(page, target.id, "memory");
      await clickBanner(page, target.id, "tool");
      await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "10"); // 7 baseline + 3 children

      const afterExpand = await allNodePositions(page);
      const childIds = Object.keys(afterExpand).filter((id) => !(id in before));
      expect(childIds).toHaveLength(3);
      expectUnrelatedNodesUnchanged(before, afterExpand, new Set(childIds));

      await clickBanner(page, target.id, "subagent");
      await clickBanner(page, target.id, "memory");
      await clickBanner(page, target.id, "tool");
      await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "7"); // project + 6 sessions

      const afterCollapse = await allNodePositions(page);
      expectUnrelatedNodesUnchanged(before, afterCollapse, new Set());
    });
  }

  test("switching the layout algorithm itself still fully reorganizes the graph", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 10 });
    const sessions = makeSessions(10);
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "cose");

    const beforeCose = await allNodePositions(page);
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "breadthfirst");
    const afterBreadthfirst = await allNodePositions(page);

    // A genuine algorithm switch is expected to move at least some nodes — this fix must not make
    // layout-switching inert.
    let anyMoved = false;
    for (const [id, pos] of Object.entries(beforeCose)) {
      const after = afterBreadthfirst[id];
      if (Math.abs(after.x - pos.x) > 1 || Math.abs(after.y - pos.y) > 1) {
        anyMoved = true;
        break;
      }
    }
    expect(anyMoved).toBe(true);
  });
});
