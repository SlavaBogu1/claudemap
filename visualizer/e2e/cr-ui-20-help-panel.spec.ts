import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-20 acceptance criteria: "Help" appears in the burger dropdown alongside the existing three
// entries; opens a modal; each documented example shows both raw source and a live-rendered result
// using the real CR-UI-19 renderer. All against a mocked API — never a live Indexer.

test.describe("CR-UI-20 — Help burger-menu entry", () => {
  test("Help appears in the burger dropdown and opens a modal", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    const items = page.getByRole("menuitem");
    // CR-UI-39 added "Collapse All" as a 6th item.
    await expect(items).toHaveText([
      "Preferences",
      "Documentation",
      "About",
      "Help",
      "Refresh",
      "Collapse All",
    ]);

    await page.getByRole("menuitem", { name: "Help" }).click();
    await expect(page.getByRole("dialog", { name: /help/i })).toBeVisible();
  });

  test("each example shows raw source and a real live-rendered result (a real <strong>/<a> element)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Help" }).click();

    const examples = page.getByTestId("help-example");
    await expect(examples).toHaveCount(7);

    const boldExample = examples.filter({ hasText: "Bold" });
    await expect(boldExample.getByTestId("help-example-source")).toHaveText("**bold text**");
    await expect(boldExample.getByTestId("help-example-rendered").locator("strong")).toHaveText(
      "bold text",
    );

    const linkExample = examples.filter({ hasText: "Link" });
    const renderedLink = linkExample.getByTestId("help-example-rendered").locator("a");
    await expect(renderedLink).toHaveText("Claude Session Explorer");
    await expect(renderedLink).toHaveAttribute("href", "https://example.com");
  });

  test("closing the Help panel works the same as Documentation/About (CR-UI-41: burger-icon click, no Close button)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Help" }).click();
    await expect(page.getByRole("dialog", { name: /help/i })).toBeVisible();

    // CR-UI-41: the explicit "Close" button is gone — inverted (not deleted) so a future
    // accidental re-add is still caught.
    await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);

    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: /help/i })).toHaveCount(0);
  });
});
