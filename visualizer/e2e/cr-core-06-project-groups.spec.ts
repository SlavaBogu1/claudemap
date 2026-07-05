import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-CORE-06 acceptance criteria (VZ-8.7/8.8, D26 — approved mockup): the project picker gains a
// Code/Cowork/Chat grouped dropdown, sourced from the new GET /api/projects/project-groups
// endpoint. Cowork/Chat pseudo-project ids reuse the exact same per-project routes as Code projects
// (.../sessions, .../detail, .../content) per the Indexer's architecture — these tests verify the
// Visualizer's existing project-selection code path really does "just work" for them, not just
// assume it. All against a mocked API — never a live Indexer server.

function optionsIn(page: import("@playwright/test").Page, groupLabel: string) {
  return page.locator(`#project-select optgroup[label="${groupLabel}"] option`);
}

test.describe("CR-CORE-06 — Code/Cowork/Chat project-groups picker", () => {
  test("the picker shows three groups — Code, Cowork, Chat — populated from real-data-shaped mock data", async ({
    page,
  }) => {
    const codeProject = makeProject({ id: "sudoku", path: "D:\\repos\\Sudoku", sessionCount: 20 });
    await mockApi(page, {
      projects: [codeProject],
      sessionsByProjectId: { sudoku: makeSessions(20) },
      projectGroups: {
        code: [{ id: "sudoku", name: "D:\\repos\\Sudoku", sessionCount: 20 }],
        cowork: [
          { id: "cowork:space-ew", name: "EW market", sessionCount: 12 },
          { id: "cowork:space-vendor", name: "Vendor Intelligence", sessionCount: 7 },
        ],
        chat: [
          { id: "chat:local_c6462ffa", name: "Write Team Experience Summary", sessionCount: 1 },
          { id: "chat:local_a1b2c3d4", name: "Analyze Team Expertise", sessionCount: 1 },
        ],
      },
    });

    await page.goto("/");

    await expect(optionsIn(page, "Code")).toHaveText(["Sudoku (20 sessions)"]);
    await expect(optionsIn(page, "Cowork")).toHaveText([
      "EW market (12 sessions)",
      "Vendor Intelligence (7 sessions)",
    ]);
    // CR-CORE-06 (approved mockup): singular "(1 session)" for a count of exactly 1.
    await expect(optionsIn(page, "Chat")).toHaveText([
      "Write Team Experience Summary (1 session)",
      "Analyze Team Expertise (1 session)",
    ]);
  });

  test("a Cowork session's grouping label matches its resolved Space name; a Chat session appears under Chat, not nested under any Space", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1) },
      projectGroups: {
        code: [],
        cowork: [{ id: "cowork:space-ew", name: "EW market", sessionCount: 3 }],
        chat: [{ id: "chat:local_1", name: "Ungrouped Chat", sessionCount: 1 }],
      },
    });

    await page.goto("/");

    // The Cowork entry's visible label is exactly the resolved Space name (server-side grouping —
    // the Visualizer only renders what the endpoint returns, does no grouping of its own).
    await expect(optionsIn(page, "Cowork")).toHaveText(["EW market (3 sessions)"]);
    // The Chat entry lives under "Chat" only — never duplicated under "Cowork".
    await expect(optionsIn(page, "Chat")).toHaveText(["Ungrouped Chat (1 session)"]);
    await expect(optionsIn(page, "Cowork")).toHaveCount(1);
  });

  test("a group with zero entries renders no optgroup at all (Cowork/Chat only — Code always renders)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1) },
      // projectGroups omitted -> { code: [], cowork: [], chat: [] } — no Claude Desktop data.
    });

    await page.goto("/");
    await expect(page.locator('#project-select optgroup[label="Code"]')).toHaveCount(1);
    await expect(page.locator('#project-select optgroup[label="Cowork"]')).toHaveCount(0);
    await expect(page.locator('#project-select optgroup[label="Chat"]')).toHaveCount(0);
  });

  test("selecting a Cowork item renders its real session graph and content via the existing per-project code path", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const coworkId = "cowork:space-ew";
    const coworkSessions = makeSessions(3).map((s) => ({
      ...s,
      // v1.11: subagent/memory/tool/file parity not built yet for Cowork/Chat this sprint.
      subagentCount: 0,
      memoryTouchCount: 0,
      toolResultCount: 0,
      fileCount: 0,
    }));

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1), [coworkId]: coworkSessions },
      sessionContentByKey: {
        [`${coworkId}/${coworkSessions[0].id}`]: {
          messages: [
            { role: "user", text: "Schedule the market review.", timestamp: "2026-06-02T09:00:00Z" },
            { role: "assistant", text: "Scheduled for Friday.", timestamp: "2026-06-02T09:01:00Z" },
          ],
        },
      },
      projectGroups: {
        code: [],
        cowork: [{ id: coworkId, name: "EW market", sessionCount: 3 }],
        chat: [],
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption(coworkId);

    // Same graph rendering as any Code project — project node + N session nodes, no special-casing.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4");

    await clickGraphNode(page, coworkSessions[0].id);
    await page.getByRole("tab", { name: "Content" }).click();
    await expect(page.getByTestId("session-transcript")).toContainText("Schedule the market review.");
    await expect(page.getByTestId("session-transcript")).toContainText("Scheduled for Friday.");
  });

  test("selecting a Chat item (single ungrouped session) renders its real content the same way", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const chatId = "chat:local_c6462ffa";
    const chatSessions = makeSessions(1).map((s) => ({
      ...s,
      subagentCount: 0,
      memoryTouchCount: 0,
      toolResultCount: 0,
      fileCount: 0,
    }));

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: makeSessions(1), [chatId]: chatSessions },
      sessionContentByKey: {
        [`${chatId}/${chatSessions[0].id}`]: {
          messages: [
            { role: "user", text: "Summarize the team's week.", timestamp: "2026-06-02T09:00:00Z" },
          ],
        },
      },
      projectGroups: {
        code: [],
        cowork: [],
        chat: [{ id: chatId, name: "Write Team Experience Summary", sessionCount: 1 }],
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption(chatId);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2"); // project + 1 session

    await clickGraphNode(page, chatSessions[0].id);
    await page.getByRole("tab", { name: "Content" }).click();
    await expect(page.getByTestId("session-transcript")).toContainText("Summarize the team's week.");
  });

  test("existing Code-project behavior is completely unaffected (regression: selection, drill-down, Open Folder)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    const sessions = makeSessions(5);
    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      projectGroups: {
        code: [{ id: "sudoku", name: "D:\\repos\\Sudoku", sessionCount: 5 }],
        cowork: [{ id: "cowork:space-ew", name: "EW market", sessionCount: 3 }],
        chat: [{ id: "chat:local_1", name: "Some Chat", sessionCount: 1 }],
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");

    await clickGraphNode(page, sessions[0].id);
    await expect(page.getByTestId("session-detail")).toBeVisible();

    await page.getByRole("button", { name: "Open Folder" }).click();
    await expect.poll(() => handle.openFolderCalls).toEqual(["sudoku"]);
  });
});
