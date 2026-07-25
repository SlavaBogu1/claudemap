import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-UI-34 acceptance criteria: the note editor's computed background/text color follow the active
// theme (Light/Dark/System) instead of the browser's default white/black; editing/save/delete stay
// fully functional (color-only change). All against a mocked API — never a live Indexer server.

async function setTheme(page: import("@playwright/test").Page, value: "light" | "dark" | "system") {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await page.getByLabel(/^theme/i).selectOption(value);
  // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
  await page.getByRole("button", { name: "Menu" }).click();
}

async function openContentTab(page: import("@playwright/test").Page, sessionId: string) {
  await clickGraphNode(page, sessionId);
  await page.getByRole("tab", { name: "Content" }).click();
}

async function textareaColors(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".note-textarea")!;
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
}

test.describe("CR-UI-34 — note editor Dark-theme fix", () => {
  test("Dark theme: computed background/color match --bg/--text-h, not the browser default white/black", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${sessions[0].id}`]: { messages: [] } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTab(page, sessions[0].id);
    await setTheme(page, "dark");

    const { background, color } = await textareaColors(page);
    expect(background).toBe("rgb(22, 23, 29)"); // --bg dark (#16171d)
    expect(color).toBe("rgb(243, 244, 246)"); // --text-h dark (#f3f4f6)
  });

  test("Light theme: appearance is visually unchanged (regression)", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${sessions[0].id}`]: { messages: [] } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTab(page, sessions[0].id);
    await setTheme(page, "light");

    const { background, color } = await textareaColors(page);
    expect(background).toBe("rgb(255, 255, 255)"); // --bg light (#fff)
    expect(color).toBe("rgb(8, 6, 13)"); // --text-h light (#08060d)
  });

  test("System theme with OS set to dark also shows the dark-themed note editor", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${sessions[0].id}`]: { messages: [] } },
    });
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTab(page, sessions[0].id);
    await setTheme(page, "system");

    const { background } = await textareaColors(page);
    expect(background).toBe("rgb(22, 23, 29)");
  });

  test("typing/saving/deleting remains fully functional under Dark theme (color-only change)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${sessions[0].id}`]: { messages: [] } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTab(page, sessions[0].id);
    await setTheme(page, "dark");

    await page.getByLabel("Note").fill("Dark-theme note test.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => handle.notes).toHaveLength(1);

    await page.getByRole("button", { name: "Delete Note" }).click();
    await expect.poll(() => handle.notes).toHaveLength(0);
  });
});
