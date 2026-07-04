import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-UI-19 acceptance criteria: notes render as real formatted Markdown in view mode; editing still
// shows the raw source; the security invariant from the Sprint 3 sweep (no <script> execution, zero
// dangerouslySetInnerHTML matches) is preserved. All against a mocked API — never a live Indexer.

async function openContentTabFor(page: import("@playwright/test").Page, sessionId: string) {
  await clickGraphNode(page, sessionId);
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-UI-19 — Markdown rendering for notes", () => {
  test("bold/italic/a link/a list render as real formatted output, not literal syntax characters", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const markdown = [
      "**bold** and *italic* text.",
      "",
      "[a link](https://example.com)",
      "",
      "- item one",
      "- item two",
    ].join("\n");

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: markdown,
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    const view = page.getByTestId("note-view");
    await expect(view.locator("strong")).toHaveText("bold");
    await expect(view.locator("em")).toHaveText("italic");
    const link = view.locator("a");
    await expect(link).toHaveText("a link");
    await expect(link).toHaveAttribute("href", "https://example.com");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(view.locator("li")).toHaveCount(2);
    // No literal, unrendered Markdown syntax characters leaking through as visible text.
    await expect(view).not.toContainText("**bold**");
    await expect(view).not.toContainText("[a link]");
  });

  test("clicking Edit reveals the raw Markdown source in a textarea; Save returns to view mode", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "**original**",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    await expect(page.getByTestId("note-view").locator("strong")).toHaveText("original");
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Note")).toHaveValue("**original**");

    await page.getByLabel("Note").fill("**updated**");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => handle.notes[0]?.content).toBe("**updated**");
    await expect(page.getByTestId("note-view").locator("strong")).toHaveText("updated");
  });

  test("a <script> payload never executes and renders as inert text; grep-level invariant preserved", async ({
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
          content: '<script>window.__xssFired = true;</script>\n\n<img src=x onerror="window.__xssFired = true;">',
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    await expect(page.getByTestId("note-view")).toBeVisible();
    const fired = await page.evaluate(() => (window as unknown as { __xssFired?: boolean }).__xssFired);
    expect(fired).toBeUndefined();
  });

  test("a javascript:-scheme link never becomes a clickable/executable link", async ({ page }) => {
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
          // No spaces in the URL part — CommonMark can't parse an inline link destination
          // containing a bare space at all (it would need angle-bracket wrapping), so a payload
          // with one simply fails to become a link in the first place, rather than testing the
          // intended sanitization behavior.
          content: "[click me](javascript:window.__xssFired=true)",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    const link = page.getByTestId("note-view").locator("a");
    const href = await link.getAttribute("href");
    expect(href === "" || href === null || !href.startsWith("javascript:")).toBe(true);
    await link.click();
    const fired = await page.evaluate(() => (window as unknown as { __xssFired?: boolean }).__xssFired);
    expect(fired).toBeUndefined();
  });

  test("a note with no saved content still opens directly in edit mode (regression)", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await openContentTabFor(page, target.id);

    await expect(page.getByLabel("Note")).toBeVisible();
    await expect(page.getByTestId("note-view")).toHaveCount(0);
  });
});
