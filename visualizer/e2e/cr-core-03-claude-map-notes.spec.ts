import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-CORE-03 acceptance criteria (Visualizer half): claude-map notes fetched alongside user notes,
// unioned into the existing badge (one badge per session for either kind, never two); a new
// view-only section in the Content tab for a session's claude-map note, with no reachable
// save/delete control. All against a mocked API — never a live Indexer server.

async function openContentTabFor(page: import("@playwright/test").Page, sessionId: string) {
  await clickGraphNode(page, sessionId);
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-CORE-03 — claude-map notes (badge + view-only content)", () => {
  test("a session with only a claude-map note (no user note) shows exactly one badge", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      claudeMapNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "First tagged moment.",
          createdAt: "2026-07-03T12:00:00Z",
          updatedAt: "2026-07-03T12:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await expect(page.locator(`[data-testid="note-badge"][data-node-id="${target.id}"]`)).toHaveCount(1);
  });

  test("a session with both a user note and a claude-map note still shows exactly one badge (not two)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "user note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
      claudeMapNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "tagged moment",
          createdAt: "2026-07-03T12:00:00Z",
          updatedAt: "2026-07-03T12:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await expect(page.locator(`[data-testid="note-badge"][data-node-id="${target.id}"]`)).toHaveCount(1);
  });

  test("a session with neither kind of note shows no badge", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await expect(page.locator('[data-testid="note-badge"]')).toHaveCount(0);
  });

  test("the Content tab shows a view-only claude-map section with no reachable save/delete control", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
      claudeMapNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "First tagged moment.\n\nSecond tagged moment.",
          createdAt: "2026-07-03T12:00:00Z",
          updatedAt: "2026-07-03T12:05:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    const section = page.getByTestId("claude-map-note");
    await expect(section).toContainText("First tagged moment.");
    await expect(section).toContainText("Second tagged moment.");
    // No save/delete control reachable within the claude-map section itself.
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(section.locator("textarea")).toHaveCount(0);

    // The existing editable user-note textarea is unaffected — still present, still separate.
    await expect(page.getByLabel("Note")).toBeVisible();
  });

  test("a session with no claude-map note shows no claude-map section", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    await expect(page.getByTestId("claude-map-note")).toHaveCount(0);
  });

  test("existing CR-UI-08 user-note editing is unaffected by claude-map notes being present", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
      claudeMapNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "tagged moment",
          createdAt: "2026-07-03T12:00:00Z",
          updatedAt: "2026-07-03T12:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    await page.getByLabel("Note").fill("A real user note.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => handle.notes).toHaveLength(1);
    expect(handle.notes[0]).toMatchObject({ content: "A real user note." });
    // The claude-map section keeps rendering its own separate content, untouched by the user save.
    await expect(page.getByTestId("claude-map-note")).toContainText("tagged moment");
  });
});
