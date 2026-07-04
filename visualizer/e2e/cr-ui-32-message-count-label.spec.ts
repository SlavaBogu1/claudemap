import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-32 acceptance criteria: session node labels gain a 3rd line showing messageCount, matching
// the session's real value from the API response. All against a mocked API — never a live Indexer.

test.describe("CR-UI-32 — session label message count", () => {
  test("a session node's label shows exactly 3 lines, the 3rd matching its real messageCount", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, messageCount: 137 }));
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    const label = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).data("label") as string;
    }, sessions[0].id);

    const lines = label.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("137");
  });

  test("the project node's label is unaffected (unrelated, single-line)", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    const label = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes('[type = "project"]').first().data("label") as string;
    });
    expect(label.includes("\n")).toBe(false);
  });
});
