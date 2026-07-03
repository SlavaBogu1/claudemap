import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-26 acceptance criteria: the Info tab's (repurposed) preview area shows the currently
// selected item's note — any item type, project/session/subagent/memory/tool — or "This item has
// no notes." when none exists; clicking it switches to the Content tab. All against a mocked API —
// never a live Indexer server.

function previewArea(page: import("@playwright/test").Page) {
  return page.getByTestId("session-preview");
}

test.describe("CR-UI-26 — Info tab preview shows the item's note", () => {
  test("shows the note's content when the selected session has a saved note", async ({ page }) => {
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
          content: "Revisit this refactor before the release.",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);

    await expect(previewArea(page)).toHaveText("Revisit this refactor before the release.");
  });

  test("shows 'This item has no notes.' when the selected item has no note", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);

    await expect(previewArea(page)).toHaveText("This item has no notes.");
  });

  test("clicking the preview area switches to the Content tab, regardless of item type", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    // project node
    await clickGraphNode(page, `project:sudoku`);
    await previewArea(page).click();
    await expect(page.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");

    // back to Info, then a subagent sub-item
    await page.getByRole("tab", { name: "Info" }).click();
    await clickBanner(page, target.id, "subagent");
    await clickGraphNode(page, `${target.id}:subagent:a1`);
    await previewArea(page).click();
    await expect(page.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");
  });

  test("works for every selectable item type, not session-only", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await clickBanner(page, target.id, "tool");

    for (const nodeId of [
      "project:sudoku",
      target.id,
      `${target.id}:subagent:a1`,
      `${target.id}:memory:memory/PLAN.md`,
      `${target.id}:tool:tool_x`,
    ]) {
      await clickGraphNode(page, nodeId);
      await expect(previewArea(page)).toHaveText("This item has no notes.");
    }
  });

  test("no selection at all: unchanged 'Select a session node' hint, no preview area", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await expect(previewArea(page)).toHaveCount(0);
    await expect(page.getByText(/select a session node to see its detail/i)).toBeVisible();
  });
});
