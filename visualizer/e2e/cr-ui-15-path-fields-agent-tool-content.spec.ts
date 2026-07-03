import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-15 acceptance criteria: per-item-type path fields (Project/Memory/Tool/Agent) + real
// Agent/Tool content in the Content tab. All against a mocked API — never a live Indexer server.

async function openContentTab(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Content" }).click();
}

test.describe("CR-UI-15 — path fields + Agent/Tool content", () => {
  test("selecting a project/session shows 'Project Path' with the real folder path", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1, path: "C:\\Users\\me\\repos\\sudoku" });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByLabel("Project Path")).toHaveValue("C:\\Users\\me\\repos\\sudoku");

    await clickGraphNode(page, target.id);
    await expect(page.getByLabel("Project Path")).toHaveValue("C:\\Users\\me\\repos\\sudoku");
  });

  test("selecting a memory-touch item shows 'Memory Path' with the correct file path", async ({ page }) => {
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
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "memory");
    await clickGraphNode(page, `${target.id}:memory:memory/PLAN.md`);

    await expect(page.getByLabel("Memory Path")).toHaveValue("memory/PLAN.md");
  });

  test("selecting a Tool item shows 'Tool Path' with the correct file path", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "tool");
    await clickGraphNode(page, `${target.id}:tool:tool_x`);

    await expect(page.getByLabel("Tool Path")).toHaveValue("overflow/tool_x.txt");
  });

  test("selecting a subagent item shows 'Agent Path' with real data, not a placeholder or undefined", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [
        {
          agentId: "a1",
          agentType: "general-purpose",
          description: "sub",
          filePath: "D:\\home\\.claude\\projects\\sudoku\\session-0\\subagents\\agent-a1.jsonl",
        },
      ],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "subagent");
    await clickGraphNode(page, `${target.id}:subagent:a1`);

    await expect(page.getByLabel("Agent Path")).toHaveValue(
      "D:\\home\\.claude\\projects\\sudoku\\session-0\\subagents\\agent-a1.jsonl",
    );
  });

  test("viewing a Tool item's Content tab renders its raw text as plain read-only text", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const detail = makeSessionDetail({
      overflows: [{ toolUseId: "tool_x", filePath: "overflow/tool_x.txt" }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      toolContentByKey: {
        "sudoku/overflow/tool_x.txt": "Full overflow content that was too large to inline....",
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "tool");
    await clickGraphNode(page, `${target.id}:tool:tool_x`);
    await openContentTab(page);

    await expect(page.getByTestId("tool-content")).toContainText(
      "Full overflow content that was too large to inline",
    );
  });

  test("viewing a subagent's Content tab renders real transcript content", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const filePath = "D:\\home\\.claude\\projects\\sudoku\\session-0\\subagents\\agent-a1.jsonl";
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub", filePath }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      agentContentByKey: {
        [`sudoku/${filePath}`]: {
          messages: [
            { role: "user", text: "You are a helper agent...", timestamp: "2026-06-02T09:01:30Z" },
            { role: "assistant", text: "Done — auth module refactored.", timestamp: "2026-06-02T09:01:45Z" },
          ],
        },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "subagent");
    await clickGraphNode(page, `${target.id}:subagent:a1`);
    await openContentTab(page);

    const transcript = page.getByTestId("subagent-transcript");
    await expect(transcript).toContainText("You are a helper agent");
    await expect(transcript).toContainText("Done — auth module refactored.");
  });

  test("viewing a subagent's Content tab renders a synthesized message when only a .meta.json summary exists", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];
    const filePath = "D:\\home\\.claude\\projects\\sudoku\\session-0\\subagents\\agent-a1.meta.json";
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub", filePath }],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      agentContentByKey: {
        [`sudoku/${filePath}`]: {
          messages: [{ role: "assistant", text: "Refactor helper", timestamp: "2026-06-02T09:01:30Z" }],
        },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickBanner(page, target.id, "subagent");
    await clickGraphNode(page, `${target.id}:subagent:a1`);
    await openContentTab(page);

    await expect(page.getByTestId("subagent-transcript")).toContainText("Refactor helper");
  });

  test("regression: existing session/memory Content-tab behavior is unaffected", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionContentByKey: {
        [`sudoku/${target.id}`]: {
          messages: [{ role: "user", text: "Let's refactor.", timestamp: "2026-06-02T09:00:00Z" }],
        },
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await openContentTab(page);

    await expect(page.getByTestId("session-transcript")).toContainText("Let's refactor.");
  });
});
