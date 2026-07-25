import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-41 acceptance criteria: Preferences/About/Documentation/Help behave like a standard
// dropdown/overlay — no layout shift on open, close on outside-click or another burger-icon click,
// no explicit "Close" button, and a click inside the panel doesn't close it. All against a mocked
// API — never a live Indexer server.

const PANELS = ["Preferences", "About", "Documentation", "Help"] as const;

async function openPanel(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: name }).click();
}

test.describe("CR-UI-41 — burger-menu panels: standard dropdown close behavior", () => {
  for (const panel of PANELS) {
    test(`${panel}: clicking outside the panel closes it`, async ({ page }) => {
      await mockApi(page, { projects: [], sessionsByProjectId: {} });
      await page.goto("/");

      await openPanel(page, panel);
      await expect(page.getByRole("dialog", { name: new RegExp(panel, "i") })).toBeVisible();

      // Clicks near the corner of the viewport, well outside the centered `.modal` box — the
      // topmost element there is `.modal-overlay` itself (a full-screen backdrop, z-index 100),
      // which must count as "outside" the panel.
      await page.mouse.click(5, 5);

      await expect(page.getByRole("dialog", { name: new RegExp(panel, "i") })).toHaveCount(0);
    });

    test(`${panel}: no visible "Close" button`, async ({ page }) => {
      await mockApi(page, { projects: [], sessionsByProjectId: {} });
      await page.goto("/");

      await openPanel(page, panel);
      await expect(page.getByRole("dialog", { name: new RegExp(panel, "i") })).toBeVisible();
      // CR-UI-41: inverted (not deleted) so a future accidental re-add of the Close button is
      // still caught.
      await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);
    });

    test(`${panel}: clicking the burger icon while open closes it without reopening the dropdown list`, async ({
      page,
    }) => {
      await mockApi(page, { projects: [], sessionsByProjectId: {} });
      await page.goto("/");

      await openPanel(page, panel);
      await expect(page.getByRole("dialog", { name: new RegExp(panel, "i") })).toBeVisible();

      await page.getByRole("button", { name: "Menu" }).click();

      await expect(page.getByRole("dialog", { name: new RegExp(panel, "i") })).toHaveCount(0);
      await expect(page.getByRole("menuitem")).toHaveCount(0);
    });
  }

  test("clicking inside an open Preferences panel (a field) does not close it", async ({ page }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");

    await openPanel(page, "Preferences");
    await expect(page.getByRole("dialog", { name: /preferences/i })).toBeVisible();

    await page.getByLabel(/show session banners/i).click();
    await expect(page.getByRole("dialog", { name: /preferences/i })).toBeVisible();

    await page.getByLabel(/default graph layout/i).selectOption("breadthfirst");
    await expect(page.getByRole("dialog", { name: /preferences/i })).toBeVisible();
  });

  test("opening any of the four panels does not shift/resize the header's other controls (regression, commit 65dae2b)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.goto("/");

    const menuButton = page.getByRole("button", { name: "Menu" });
    const before = await menuButton.boundingBox();
    expect(before).not.toBeNull();

    for (const panel of PANELS) {
      await openPanel(page, panel);
      await expect(page.getByRole("dialog", { name: new RegExp(panel, "i") })).toBeVisible();
      const during = await menuButton.boundingBox();
      expect(during).toEqual(before);
      // Close via burger-icon click before opening the next panel.
      await page.getByRole("button", { name: "Menu" }).click();
    }
  });

  test("regression: existing burger-menu item count (6, CR-UI-39) still holds once Close buttons are removed", async ({
    page,
  }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("menuitem")).toHaveCount(6);
  });
});
