import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-14 acceptance criteria (VZ-3.10/3.11): the previously-"Overflow" drill-down type is now
// labeled "Tool" with a ⚙ icon — a rename only, no new data. Against a mocked API only.

test.describe("CR-UI-14 — Overflow renamed to Tool", () => {
  test("expanding a session's drill-down shows the Tool child labeled with a gear icon", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    const sessions = makeSessions(3);
    const target = sessions[0];
    const detail = makeSessionDetail({
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4"); // project + 3 sessions
    // CR-UI-07 (Sprint 3): drill-down is now exclusively a per-banner action (session-body click no
    // longer expands) — click the ⚙ Tool banner to expand this session's Tool child.
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "5"); // + 1 tool child

    const toolNodeInfo = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      const nodes = cy.nodes('[type = "tool"]');
      return { count: nodes.length, label: nodes.length > 0 ? nodes[0].data("label") : null };
    });

    expect(toolNodeInfo.count).toBe(1);
    expect(toolNodeInfo.label).toContain("⚙ Tool");
    expect(toolNodeInfo.label).toContain("tool_x.txt");
    expect(toolNodeInfo.label).not.toContain("Overflow");

    // No lingering "overflow" typed node anywhere in the graph.
    const overflowCount = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes('[type = "overflow"]').length;
    });
    expect(overflowCount).toBe(0);
  });
});
