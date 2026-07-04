import { test, expect } from "@playwright/test";
import { makeProject, mockApi, type MockSession } from "./fixtures";

// CR-UI-33 acceptance criteria: a "Session color scheme" Preferences field recolors session node
// backgrounds by Size/Time/Duration, theme-aware. All against a mocked API — never a live Indexer.

function gradientSessions(): MockSession[] {
  return [
    {
      id: "s-low",
      startedAt: "2026-06-01T10:00:00Z",
      endedAt: "2026-06-01T10:05:00Z", // shortest
      messageCount: 5, // fewest
      gitBranch: "main",
      preview: "low",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-high",
      startedAt: "2026-06-20T10:00:00Z", // most recent
      endedAt: "2026-06-20T13:00:00Z", // longest
      messageCount: 500, // most
      gitBranch: "main",
      preview: "high",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
  ];
}

async function nodeColor(page: import("@playwright/test").Page, id: string): Promise<string> {
  return page.evaluate((nodeId) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy.getElementById(nodeId).style("background-color");
  }, id);
}

async function setScheme(page: import("@playwright/test").Page, value: string) {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await page.getByLabel(/session color scheme/i).selectOption(value);
  await page.getByRole("button", { name: "Close" }).click();
}

test.describe("CR-UI-33 — Session color scheme", () => {
  test("Preferences shows a Session color scheme field with all 4 options", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: gradientSessions() } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();

    const select = page.getByLabel(/session color scheme/i);
    const optionTexts = await select.locator("option").allTextContents();
    expect(optionTexts).toEqual(["Default", "Size Grad", "Time Grad", "Duration Grad"]);
  });

  for (const scheme of ["sizeGrad", "timeGrad", "durationGrad"]) {
    test(`selecting ${scheme} colors sessions differently by metric (green=high, red=low)`, async ({
      page,
    }) => {
      const project = makeProject({ id: "sudoku", sessionCount: 2 });
      await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: gradientSessions() } });

      await page.goto("/");
      await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
      await setScheme(page, scheme);

      const lowColor = await nodeColor(page, "s-low");
      const highColor = await nodeColor(page, "s-high");
      expect(lowColor).not.toBe(highColor);
    });
  }

  test("the same scheme produces different actual colors under Light vs Dark theme", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: gradientSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await setScheme(page, "sizeGrad");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/^theme/i).selectOption("light");
    await page.getByRole("button", { name: "Close" }).click();
    const lightColor = await nodeColor(page, "s-high");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/^theme/i).selectOption("dark");
    await page.getByRole("button", { name: "Close" }).click();
    const darkColor = await nodeColor(page, "s-high");

    expect(lightColor).not.toBe(darkColor);
  });

  test("Default restores the flat gray exactly as it renders today", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: gradientSessions() } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "3");
    const flatColor = await nodeColor(page, "s-low");
    expect(flatColor).toBe("rgb(229,228,231)"); // LIGHT_PALETTE.defaultBg (#e5e4e7)

    await setScheme(page, "sizeGrad");
    expect(await nodeColor(page, "s-low")).not.toBe(flatColor);

    await setScheme(page, "default");
    expect(await nodeColor(page, "s-low")).toBe(flatColor);
  });

  test("selection border and banner/note-badge overlays remain visible on gradient-colored nodes", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    const sessions = gradientSessions().map((s) => ({ ...s, memoryTouchCount: 1 }));
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: "s-high",
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await setScheme(page, "sizeGrad");

    const box = await page.locator(".graph-canvas-wrapper").boundingBox();
    if (!box) throw new Error("no canvas");
    const pos = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById("s-high").renderedPosition();
    });
    await page.mouse.click(box.x + pos.x, box.y + pos.y);

    const isSelected = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById("s-high").hasClass("selected");
    });
    expect(isSelected).toBe(true);

    await expect(
      page.locator('[data-testid="session-banner-row"][data-session-id="s-high"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="note-badge"][data-node-id="s-high"]')).toBeVisible();
  });

  test("the choice persists via localStorage across a reload, defaulting to Default when never set", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: gradientSessions() } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/session color scheme/i)).toHaveValue("default");
    await page.getByRole("button", { name: "Close" }).click();

    await setScheme(page, "durationGrad");
    await page.reload();
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await expect(page.getByLabel(/session color scheme/i)).toHaveValue("durationGrad");
  });
});
