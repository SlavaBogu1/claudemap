import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-UI-25 acceptance criteria: the project node's Content tab shows real project-level info,
// resolved server-side (README.md -> CLAUDE.md -> earliest session's first user message -> none).
// All against a mocked API — never a live Indexer server.

async function openContentTab(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-UI-25 — Project node's Content tab", () => {
  test("a project with a README.md shows that file's raw text, labeled as such", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1) },
      projectContentByKey: { sudoku: { source: "readme", content: "# My Project\n\nA sudoku solver." } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, "project:sudoku");
    await openContentTab(page);

    await expect(page.getByTestId("project-content-source")).toHaveText("From README.md");
    await expect(page.getByTestId("project-content")).toContainText("A sudoku solver.");
  });

  test("a project with no README.md but a CLAUDE.md shows that file's text instead", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1) },
      projectContentByKey: { sudoku: { source: "claude-md", content: "# CLAUDE.md\n\nProject rules." } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, "project:sudoku");
    await openContentTab(page);

    await expect(page.getByTestId("project-content-source")).toHaveText("From CLAUDE.md");
    await expect(page.getByTestId("project-content")).toContainText("Project rules.");
  });

  test("a project with neither file shows its earliest session's first user message", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1) },
      projectContentByKey: {
        sudoku: { source: "first-message", content: "Let's build a sudoku solver." },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, "project:sudoku");
    await openContentTab(page);

    await expect(page.getByTestId("project-content-source")).toHaveText("First message");
    await expect(page.getByTestId("project-content")).toContainText("Let's build a sudoku solver.");
  });

  test("a project with neither file and zero sessions shows a clear empty state, not an error", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 0 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: [] },
      projectContentByKey: { sudoku: { source: "none", content: null } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, "project:sudoku");
    await openContentTab(page);

    await expect(page.getByTestId("project-content-none")).toContainText(
      "No README, CLAUDE.md, or sessions found",
    );
    await expect(page.locator(".error-text")).toHaveCount(0);
  });

  test("regression: existing session/memory/Agent/Tool Content behavior is unaffected", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: {
        [`sudoku/${target.id}`]: {
          messages: [{ role: "user", text: "Refactor the auth module.", timestamp: "2026-06-02T09:00:00Z" }],
        },
      },
      projectContentByKey: { sudoku: { source: "readme", content: "# README" } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);
    await expect(page.getByTestId("session-transcript")).toContainText("Refactor the auth module.");

    await page.getByRole("tab", { name: "Info" }).click();
    await clickGraphNode(page, "project:sudoku");
    await openContentTab(page);
    await expect(page.getByTestId("project-content")).toContainText("# README");
  });
});
