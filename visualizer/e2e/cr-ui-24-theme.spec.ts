import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-24 acceptance criteria: a Light/Dark/System theme switch in Preferences restyles the whole
// app, including the Cytoscape canvas's node colors (previously hardcoded light-theme hex values).
// All against a mocked API — never a live Indexer server.

async function setTheme(page: import("@playwright/test").Page, value: "light" | "dark" | "system") {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await page.getByLabel(/theme/i).selectOption(value);
  await page.getByRole("button", { name: "Close" }).click();
}

async function projectNodeColor(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const node = cy.nodes('[type = "project"]').first();
    return node.style("background-color");
  });
}

test.describe("CR-UI-24 — Light/Dark/System theme", () => {
  test("Preferences shows a Theme field with Light/Dark/System options", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();

    const themeSelect = page.getByLabel(/theme/i);
    const optionTexts = await themeSelect.locator("option").allTextContents();
    expect(optionTexts).toEqual(["Light", "Dark", "System"]);
  });

  test("selecting Dark applies dark colors to the whole app, including the graph canvas's node colors", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.emulateMedia({ colorScheme: "light" });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    const lightColor = await projectNodeColor(page);

    await setTheme(page, "dark");
    const darkColor = await projectNodeColor(page);
    expect(darkColor).not.toBe(lightColor);

    // Chrome also switched — html carries the explicit data-theme attribute and the CSS variable
    // resolved to the dark value.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bgVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(bgVar).toBe("#16171d");
  });

  test("selecting Light applies light colors even when the OS/browser is set to dark", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await setTheme(page, "light");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bgVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(bgVar).toBe("#fff");

    const color = await projectNodeColor(page);
    // Light palette's project node fill (#aa3bff) — sanity-checked as an rgb() value.
    expect(color).toBe("rgb(170,59,255)");
  });

  test("selecting System reverts to following the OS preference, matching pre-CR behavior", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await setTheme(page, "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await setTheme(page, "system");
    // "system" removes the explicit attribute entirely — the OS/browser dark preference (emulated
    // above) takes back over via the `prefers-color-scheme` media query.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    const bgVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(bgVar).toBe("#16171d");
  });

  test("the choice persists via localStorage across a reload", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await setTheme(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/theme/i)).toHaveValue("dark");
  });

  test("a fresh install with no preference ever set defaults to System and looks identical to today's appearance", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.emulateMedia({ colorScheme: "light" });

    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/theme/i)).toHaveValue("system");
  });
});
