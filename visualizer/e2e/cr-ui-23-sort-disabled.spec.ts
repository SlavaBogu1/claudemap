import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-23 acceptance criteria: the header Sort control is disabled (non-interactive, visually
// grayed) for Force-directed and Timeline, since only Hierarchical actually visualizes sort order;
// the Preferences "Default sort" field stays always editable regardless of the current layout; the
// stored sort value is preserved (not reset) while the header control is disabled. All against a
// mocked API — never a live Indexer server.

test.describe("CR-UI-23 — Sort control disabled outside Hierarchical", () => {
  test("Force-directed disables the Sort dropdown", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(3) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("cose");

    await expect(page.getByLabel("Sort", { exact: true })).toBeDisabled();
  });

  test("Timeline disables the Sort dropdown", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(3) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline");

    await expect(page.getByLabel("Sort", { exact: true })).toBeDisabled();
  });

  test("Hierarchical (re-)enables the Sort dropdown, preserving the previously selected value", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(3) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("breadthfirst");
    await page.getByLabel("Sort", { exact: true }).selectOption("agents-desc");

    // Switch away (disables) then back (re-enables) — value is preserved, not reset.
    await page.getByLabel("Layout").selectOption("cose");
    await expect(page.getByLabel("Sort", { exact: true })).toBeDisabled();

    await page.getByLabel("Layout").selectOption("breadthfirst");
    await expect(page.getByLabel("Sort", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("agents-desc");
  });

  test("the Preferences 'Default sort' field remains editable regardless of the current layout", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(3) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await page.getByLabel("Layout").selectOption("timeline"); // header Sort is disabled here

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/default sort/i)).toBeEnabled();
    await page.getByLabel(/default sort/i).selectOption("date-asc");
    await expect(page.getByLabel(/default sort/i)).toHaveValue("date-asc");
  });
});
