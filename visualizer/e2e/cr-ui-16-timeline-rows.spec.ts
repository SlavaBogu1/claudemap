import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-16 acceptance criteria (VZ-4.5/4.6): a session's expanded Timeline drill-down children are
// grouped into up to three separate rows by type (Memory, then Subagent, then Tool, top-to-bottom)
// instead of CR-UI-09's single mixed radial cluster — a type with zero items gets no row (the next
// present type's row lands immediately after, no gap). All against a mocked API — never a live
// Indexer server. Built on top of CR-UI-09 (reopen)'s live-position fix (VZ-4.3/4.4).

async function childPositionsByType(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const result: Record<"memory" | "subagent" | "tool", { id: string; x: number; y: number }[]> = {
      memory: [],
      subagent: [],
      tool: [],
    };
    cy.nodes("[parentSessionId]").forEach((n: import("cytoscape").NodeSingular) => {
      const type = n.data("type") as "memory" | "subagent" | "tool";
      const pos = n.position();
      result[type].push({ id: n.id(), x: pos.x, y: pos.y });
    });
    return result;
  });
}

function rowY(nodes: { y: number }[]): number {
  const ys = nodes.map((n) => n.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  expect(max - min).toBeLessThan(0.01); // every sibling in the row shares the same y
  return min;
}

test.describe("CR-UI-16 — Timeline per-type drill-down rows", () => {
  test("a session with all three types present renders 3 rows, ordered Memory, then Subagent, then Tool, top-to-bottom", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: Array.from({ length: 2 }, (_, i) => ({
        agentId: `a${i}`,
        agentType: "general-purpose",
        description: "sub",
      })),
      memoryTouches: Array.from({ length: 2 }, (_, i) => ({
        filePath: `memory/topic${i}.md`,
        name: `topic${i}.md`,
      })),
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
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "9"); // project + 3 sessions + 5 children

    const byType = await childPositionsByType(page);
    expect(byType.memory).toHaveLength(2);
    expect(byType.subagent).toHaveLength(2);
    expect(byType.tool).toHaveLength(1);

    const memoryY = rowY(byType.memory);
    const subagentY = rowY(byType.subagent);
    const toolY = rowY(byType.tool);

    // Top-to-bottom means increasing y (rows are laid out progressively below the session node).
    expect(memoryY).toBeLessThan(subagentY);
    expect(subagentY).toBeLessThan(toolY);
  });

  test("a partial session (only Memory + Tool present) renders exactly 2 rows with no gap for the absent Subagent row", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
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
    await clickBanner(page, target.id, "memory");
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // project + 3 sessions + 2 children

    const byType = await childPositionsByType(page);
    expect(byType.subagent).toHaveLength(0);
    expect(byType.memory).toHaveLength(1);
    expect(byType.tool).toHaveLength(1);

    const memoryY = rowY(byType.memory);
    const toolY = rowY(byType.tool);
    const sessionPos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).position();
    }, target.id);

    // Memory (first present type) occupies row 0, directly below the session.
    const rowSpacing = toolY - memoryY;
    expect(memoryY).toBeGreaterThan(sessionPos.y);
    // Tool (the next *present* type, skipping the absent Subagent row) sits exactly one row below
    // Memory — not two rows below, which would indicate a reserved-but-empty Subagent row/gap.
    expect(rowSpacing).toBeGreaterThan(0);
    expect(rowSpacing).toBeLessThan(150); // a single row step, not a doubled gap
  });

  test("10 same-type siblings in one row render with no overlap", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: Array.from({ length: 10 }, (_, i) => ({
        agentId: `a${i}`,
        agentType: "general-purpose",
        description: `sub ${i}`,
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
    await clickBanner(page, target.id, "subagent");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "14"); // project + 3 sessions + 10 children

    const byType = await childPositionsByType(page);
    expect(byType.subagent).toHaveLength(10);
    rowY(byType.subagent); // asserts they all share one row's y

    const xs = byType.subagent.map((n) => n.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThan(20);
    }
  });
});
