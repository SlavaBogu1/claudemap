import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-17 acceptance criteria: a search box in the Content tab, case-insensitive substring match,
// safe `<mark>`-based highlighting, match count + Previous/Next navigation, covering
// session/memory/tool/agent/project content. All against a mocked API — never a live Indexer.

async function openContentTab(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-UI-17 — Content-tab search", () => {
  test("highlights every case-insensitive match in a session transcript with a correct count", async ({
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
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    await page.getByLabel("Search content").fill("refactor");
    await expect(page.locator('[data-testid^="search-match"]')).toHaveCount(2);
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 2");
  });

  test("highlights matches in memory content (raw text)", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({ memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }] });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      memoryContentByKey: { "sudoku/memory/PLAN.md": "Refactor the auth module. Then refactor tests." },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "memory");
    await clickGraphNode(page, `${target.id}:memory:memory/PLAN.md`);
    await openContentTab(page);

    await page.getByLabel("Search content").fill("refactor");
    await expect(page.locator('[data-testid^="search-match"]')).toHaveCount(2);
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 2");
  });

  test("highlights matches in Tool, Agent, and project content", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const filePath = "D:\\subagents\\agent-a1.jsonl";
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub", filePath }],
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      toolContentByKey: { "sudoku/overflow/tool_x.txt": "error: refactor failed at line 12" },
      agentContentByKey: {
        [`sudoku/${filePath}`]: {
          messages: [{ role: "assistant", text: "Refactor complete.", timestamp: "2026-06-02T09:01:30Z" }],
        },
      },
      projectContentByKey: { sudoku: { source: "readme", content: "# Sudoku\n\nA refactor-friendly solver." } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "tool");

    await clickGraphNode(page, `${target.id}:tool:tool_x`);
    await openContentTab(page);
    await page.getByLabel("Search content").fill("refactor");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 1");

    await page.getByRole("tab", { name: "Info" }).click();
    await clickGraphNode(page, `${target.id}:subagent:a1`);
    await openContentTab(page);
    await page.getByLabel("Search content").fill("refactor");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 1");

    await page.getByRole("tab", { name: "Info" }).click();
    await clickGraphNode(page, "project:sudoku");
    await openContentTab(page);
    await page.getByLabel("Search content").fill("refactor");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 1");
  });

  test("Next/Previous cycle through matches in document order, wrapping at the ends", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: {
        [`sudoku/${target.id}`]: {
          messages: [
            { role: "user", text: "cat cat cat", timestamp: "2026-06-02T09:00:00Z" },
          ],
        },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    await page.getByLabel("Search content").fill("cat");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 3");

    await page.getByRole("button", { name: "Next match" }).click();
    await expect(page.getByTestId("content-search-count")).toHaveText("2 of 3");
    await page.getByRole("button", { name: "Next match" }).click();
    await expect(page.getByTestId("content-search-count")).toHaveText("3 of 3");
    // Wraps past the last match back to the first.
    await page.getByRole("button", { name: "Next match" }).click();
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 3");

    // Previous wraps the other way.
    await page.getByRole("button", { name: "Previous match" }).click();
    await expect(page.getByTestId("content-search-count")).toHaveText("3 of 3");

    // Keyboard: Enter = Next, Shift+Enter = Previous.
    const input = page.getByLabel("Search content");
    await input.press("Enter");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 3");
    await input.press("Shift+Enter");
    await expect(page.getByTestId("content-search-count")).toHaveText("3 of 3");
  });

  test("clearing the search input removes highlights and the count", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: {
        [`sudoku/${target.id}`]: {
          messages: [{ role: "user", text: "auth refactor", timestamp: "2026-06-02T09:00:00Z" }],
        },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    await page.getByLabel("Search content").fill("refactor");
    await expect(page.locator('[data-testid^="search-match"]')).toHaveCount(1);

    await page.getByLabel("Search content").fill("");
    await expect(page.locator('[data-testid^="search-match"]')).toHaveCount(0);
    await expect(page.getByTestId("content-search-count")).toHaveText("");
  });

  test("selecting a different item resets the search query and highlights", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({ memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }] });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      sessionContentByKey: {
        [`sudoku/${target.id}`]: {
          messages: [{ role: "user", text: "refactor the module", timestamp: "2026-06-02T09:00:00Z" }],
        },
      },
      memoryContentByKey: { "sudoku/memory/PLAN.md": "unrelated plan text" },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);
    await page.getByLabel("Search content").fill("refactor");
    await expect(page.getByTestId("content-search-count")).toHaveText("1 of 1");

    // Clicking the session node body above already expanded all 3 drill-down types (CR-UI-07
    // reopen) — no separate banner click needed to reveal the memory child.
    await page.getByRole("tab", { name: "Info" }).click();
    await clickGraphNode(page, `${target.id}:memory:memory/PLAN.md`);
    await openContentTab(page);

    await expect(page.getByLabel("Search content")).toHaveValue("");
    await expect(page.locator('[data-testid^="search-match"]')).toHaveCount(0);
  });
});
