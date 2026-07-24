import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-CORE-03 acceptance criteria (Visualizer half): stick-it notes fetched alongside user notes,
// unioned into the existing badge (one badge per session for either kind, never two); a new
// view-only section in the Content tab for a session's stick-it note, with no reachable
// save/delete control. All against a mocked API — never a live Indexer server.

async function openContentTabFor(page: import("@playwright/test").Page, sessionId: string) {
  await clickGraphNode(page, sessionId);
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-CORE-03 — stick-it notes (badge + view-only content)", () => {
  test("a session with only a stick-it note (no user note) shows exactly one badge", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      stickItNotes: [
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

  test("a session with both a user note and a stick-it note still shows exactly one badge (not two)", async ({
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
      stickItNotes: [
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

  test("the Content tab shows a view-only stick-it section with no reachable save/delete control", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
      stickItNotes: [
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

    const section = page.getByTestId("stick-it-note");
    await expect(section).toContainText("First tagged moment.");
    await expect(section).toContainText("Second tagged moment.");
    // No save/delete control reachable within the stick-it section itself.
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(section.locator("textarea")).toHaveCount(0);

    // The existing editable user-note textarea is unaffected — still present, still separate.
    await expect(page.getByLabel("Note")).toBeVisible();
  });

  test("a session with no stick-it note shows no stick-it section", async ({ page }) => {
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

    await expect(page.getByTestId("stick-it-note")).toHaveCount(0);
  });

  test("existing CR-UI-08 user-note editing is unaffected by stick-it notes being present", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
      stickItNotes: [
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
    // The stick-it section keeps rendering its own separate content, untouched by the user save.
    await expect(page.getByTestId("stick-it-note")).toContainText("tagged moment");
  });

  // CR-UI-37 (Sprint 10): each stick-it note line is a clickable link into the content view above,
  // reusing CR-UI-17's existing search/highlight state — no new search mechanism.
  test("clicking a stick-it note line jumps to and highlights that text in the session content", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: {
        [`sudoku/${target.id}`]: {
          messages: [
            { role: "user", text: "Let's refactor the auth module.", timestamp: "2026-06-02T09:00:00Z" },
            { role: "assistant", text: "Sure — refactor auth now.", timestamp: "2026-06-02T09:01:00Z" },
          ],
        },
      },
      stickItNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "refactor the auth module\n\nsomething that no longer exists",
          createdAt: "2026-07-03T12:00:00Z",
          updatedAt: "2026-07-03T12:05:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    const lines = page.getByTestId("stick-it-note-line");
    await expect(lines).toHaveCount(2);

    // Clicking the first line sets the search box to that exact line text and highlights the
    // (single) match in the transcript above.
    await lines.first().click();
    await expect(page.getByLabel("Search content")).toHaveValue("refactor the auth module");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 1");
    await expect(page.getByTestId("search-match-current")).toHaveText("refactor the auth module");
    await expect(page.getByTestId("search-match-current")).toBeVisible();

    // Edge case: a note line whose text no longer appears in the (possibly re-parsed) content
    // shows "0 matches" — no crash, no highlight.
    await lines.nth(1).click();
    await expect(page.getByLabel("Search content")).toHaveValue("something that no longer exists");
    await expect(page.getByTestId("content-search-count")).toHaveText("0 matches");
    await expect(page.locator('[data-testid^="search-match"]')).toHaveCount(0);
  });
});
