import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-30 acceptance criteria: the burger-menu icon's computed `color` follows the active theme
// (Light/Dark/System) instead of falling back to the browser's default (near-black) button text
// color. All against a mocked API — never a live Indexer server.

async function setTheme(page: import("@playwright/test").Page, value: "light" | "dark" | "system") {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await page.getByLabel(/^theme/i).selectOption(value);
  // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
  await page.getByRole("button", { name: "Menu" }).click();
}

async function burgerIconColor(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector(".burger-icon")!).color);
}

test.describe("CR-UI-30 — burger-icon Dark-theme fix", () => {
  test("Dark theme: computed color matches --text-h's Dark value, not a hardcoded dark color", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await setTheme(page, "dark");

    const color = await burgerIconColor(page);
    const textHVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--text-h").trim(),
    );
    expect(textHVar).toBe("#f3f4f6");
    // #f3f4f6 -> rgb(243, 244, 246)
    expect(color).toBe("rgb(243, 244, 246)");
  });

  test("Light theme: appearance is visually unchanged (regression)", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await setTheme(page, "light");

    const color = await burgerIconColor(page);
    // #08060d -> rgb(8, 6, 13) — Light theme's --text-h, matching pre-CR appearance (coincidentally
    // already close to this value per the CR's own root-cause analysis).
    expect(color).toBe("rgb(8, 6, 13)");
  });

  test("System theme with OS set to dark also shows the light-colored (theme-following) icon", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/");
    await setTheme(page, "system");

    const color = await burgerIconColor(page);
    expect(color).toBe("rgb(243, 244, 246)"); // follows the OS dark preference, same mechanism as the rest of the app
  });

  test("the burger dropdown itself is unaffected — this fix touches only .burger-icon", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await setTheme(page, "dark");
    await page.getByRole("button", { name: "Menu" }).click();

    const dropdownItemColor = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".burger-dropdown li button")!).color,
    );
    expect(dropdownItemColor).toBe("rgb(243, 244, 246)"); // unchanged — already correctly themed before this CR
  });
});
