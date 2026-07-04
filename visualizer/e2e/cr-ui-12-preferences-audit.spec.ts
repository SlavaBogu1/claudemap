import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-12 acceptance criteria (VZ-3.16/3.17, D23 audit): PreferencesPanel.tsx holds a working
// control for every customizable option shipped so far — default layout (CR-UI-02), default sort
// (CR-UI-10), default time range (CR-UI-27, Sprint 6), show/hide banners (CR-UI-07), theme
// (CR-UI-24, Sprint 5), session color scheme (CR-UI-33, Sprint 6) — all present and functional.
// Against a mocked API only.

test.describe("CR-UI-12 — Preferences panel audit (D23)", () => {
  test("Preferences shows all six fields, each present and functional", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 3 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(3) } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();

    // All six fields are present with a working control.
    await expect(page.getByLabel(/default graph layout/i)).toBeVisible();
    await expect(page.getByLabel(/default sort/i)).toBeVisible();
    await expect(page.getByLabel(/default time range/i)).toBeVisible();
    await expect(page.getByLabel(/show session banners/i)).toBeVisible();
    await expect(page.getByLabel(/^theme/i)).toBeVisible();
    await expect(page.getByLabel(/session color scheme/i)).toBeVisible();

    // Each control is genuinely functional (changing it takes effect), not just rendered.
    await page.getByLabel(/default graph layout/i).selectOption("timeline");
    await expect(page.getByLabel(/default graph layout/i)).toHaveValue("timeline");

    await page.getByLabel(/default sort/i).selectOption("agents-asc");
    await expect(page.getByLabel(/default sort/i)).toHaveValue("agents-asc");

    await page.getByLabel(/default time range/i).selectOption("week");
    await expect(page.getByLabel(/default time range/i)).toHaveValue("week");

    await page.getByLabel(/show session banners/i).uncheck();
    await expect(page.getByLabel(/show session banners/i)).not.toBeChecked();
    await page.getByLabel(/show session banners/i).check();
    await expect(page.getByLabel(/show session banners/i)).toBeChecked();

    await page.getByLabel(/^theme/i).selectOption("dark");
    await expect(page.getByLabel(/^theme/i)).toHaveValue("dark");

    await page.getByLabel(/session color scheme/i).selectOption("sizeGrad");
    await expect(page.getByLabel(/session color scheme/i)).toHaveValue("sizeGrad");

    // The panel is scannable — no unlabeled controls (every input has an associated label).
    const modal = page.locator(".modal");
    const inputs = modal.locator("select, input");
    const count = await inputs.count();
    expect(count).toBe(6);
    for (let i = 0; i < count; i++) {
      const id = await inputs.nth(i).getAttribute("id");
      expect(id).toBeTruthy();
      await expect(modal.locator(`label[for="${id}"], label:has(#${id})`)).toHaveCount(1);
    }
  });
});
