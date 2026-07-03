import { test, expect } from "@playwright/test";
import {
  makeProject,
  makeSessions,
  mockApi,
  clickGraphNode,
  clickBanner,
  makeSessionDetail,
} from "./fixtures";

// CR-UI-08 acceptance criteria (VZ-3.14/3.15), all against a mocked API — never a live Indexer.

async function openContentTab(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-UI-08 — Content tab + inline notes", () => {
  test("selecting a session and switching to Content shows its real transcript", async ({ page }) => {
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
            { role: "assistant", text: "Sure, let's do it.", timestamp: "2026-06-02T09:01:00Z" },
          ],
        },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    const transcript = page.getByTestId("session-transcript");
    await expect(transcript).toContainText("Let's refactor the auth module.");
    await expect(transcript).toContainText("Sure, let's do it.");
  });

  test("selecting a memory-touch child node shows the raw memory file text", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      memoryContentByKey: {
        "sudoku/memory/PLAN.md": "# Plan\n\nRefactor the auth module before the release.",
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "memory");

    const memoryNodeId = `${target.id}:memory:memory/PLAN.md`;
    await clickGraphNode(page, memoryNodeId);
    await openContentTab(page);

    await expect(page.getByTestId("memory-content")).toContainText(
      "Refactor the auth module before the release.",
    );
  });

  test("saving a note persists it and updates the node's 📝 indicator; deleting removes both", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    // No note yet: empty textarea, no Delete button.
    await expect(page.getByLabel("Note")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Delete Note" })).toHaveCount(0);

    await page.getByLabel("Note").fill("Revisit this refactor before the release.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => handle.notes).toHaveLength(1);
    expect(handle.notes[0]).toMatchObject({
      projectId: "sudoku",
      nodeType: "session",
      nodeId: target.id,
      content: "Revisit this refactor before the release.",
    });

    // Node indicator appears without a reload.
    const label = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).data("label");
    }, target.id);
    expect(label).toContain("📝");

    // Delete button now present; deleting removes the note and the indicator.
    await expect(page.getByRole("button", { name: "Delete Note" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Note" }).click();

    await expect.poll(() => handle.notes).toHaveLength(0);
    await expect(page.getByLabel("Note")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Delete Note" })).toHaveCount(0);

    const labelAfterDelete = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).data("label");
    }, target.id);
    expect(labelAfterDelete).not.toContain("📝");
  });

  test("an item with an existing note shows its content and a Delete button; saving from empty upserts", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: { [`sudoku/${target.id}`]: { messages: [] } },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "Already noted.",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    await expect(page.getByLabel("Note")).toHaveValue("Already noted.");
    await expect(page.getByRole("button", { name: "Delete Note" })).toBeVisible();

    await page.getByLabel("Note").fill("Updated note text.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => handle.notes[0]?.content).toBe("Updated note text.");
  });

  test("subagent, tool, and project items show the placeholder, not an error", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "code-review", description: "reviewed the diff" }],
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
    await clickBanner(page, target.id, "tool");

    for (const nodeId of [`${target.id}:subagent:a1`, `${target.id}:tool:tool_x`, `project:sudoku`]) {
      await clickGraphNode(page, nodeId);
      await openContentTab(page);
      await expect(page.getByTestId("content-unsupported")).toBeVisible();
      await expect(page.locator(".error-text")).toHaveCount(0);
      // The note editor still works for these item types (notes attach to any item except a note).
      await expect(page.getByLabel("Note")).toBeVisible();
    }
  });
});
