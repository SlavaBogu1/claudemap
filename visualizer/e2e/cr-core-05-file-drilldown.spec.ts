import { test, expect } from "@playwright/test";
import {
  makeProject,
  makeSessions,
  mockApi,
  clickBanner,
  clickFileBadge,
  clickGraphNode,
  makeSessionDetail,
} from "./fixtures";

// CR-CORE-05 acceptance criteria (VZ-8.4/8.5/8.6): a 4th "File" drill-down type, sourced from
// `detail.files`, with a bottom-left corner badge (distinct from CR-UI-18's bottom-right note-badge
// and CR-UI-07's top banner row) that hides entirely at `fileCount` 0, is itself clickable to expand
// File children, and whose Content tab renders the real backed-up file text. All against a mocked
// API — never a live Indexer server.

function fileBadgeLocator(page: import("@playwright/test").Page, sessionId: string) {
  return page.locator(`[data-testid="file-badge"][data-session-id="${sessionId}"]`);
}

test.describe("CR-CORE-05 — File drill-down type + corner badge", () => {
  test("the File badge shows the correct unique file count and is hidden entirely when fileCount is 0", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    const sessions = makeSessions(2).map((s, i) => ({ ...s, fileCount: i === 0 ? 2 : 0 }));

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await expect(fileBadgeLocator(page, sessions[0].id)).toHaveText("💾 2");
    await expect(fileBadgeLocator(page, sessions[1].id)).toHaveCount(0);
  });

  test("clicking the File badge expands File child nodes, one per unique tracked file path; clicking again collapses them", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, fileCount: 2 }));
    const target = sessions[0];
    const detail = makeSessionDetail({
      files: [
        {
          filePath: "backend\\tests\\test_auth.py",
          backupFileName: "0087446fcc94a7fb@v2",
          version: 2,
          backupTime: "2026-06-12T00:57:40.318Z",
        },
        {
          filePath: "frontend\\App.tsx",
          backupFileName: "abc123def456@v1",
          version: 1,
          backupTime: "2026-06-12T01:00:00.000Z",
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
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2"); // project + 1 session

    await clickFileBadge(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "4"); // + 2 file children

    const fileNodeCount = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes('[type = "file"]').length;
    });
    expect(fileNodeCount).toBe(2);

    await clickFileBadge(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("body-click expand-all/collapse-all also covers File children alongside Memory/Subagent/Tool", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, fileCount: 1 }));
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "general-purpose", description: "sub" }],
      memoryTouches: [{ filePath: "memory/PLAN.md", name: "PLAN.md" }],
      overflows: [{ toolUseId: "t1", filePath: "overflow/t1.txt" }],
      files: [
        {
          filePath: "backend\\tests\\test_auth.py",
          backupFileName: "0087446fcc94a7fb@v1",
          version: 1,
          backupTime: "2026-06-12T00:57:40.318Z",
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
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // +1 each of 4 types

    const fileNodeCount = await page.evaluate(() => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.nodes('[type = "file"]').length;
    });
    expect(fileNodeCount).toBe(1);

    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  });

  test("a File child node's Content tab shows the real backed-up file text via the new endpoint", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, fileCount: 1 }));
    const target = sessions[0];
    const detail = makeSessionDetail({
      files: [
        {
          filePath: "backend\\tests\\test_auth.py",
          backupFileName: "0087446fcc94a7fb@v2",
          version: 2,
          backupTime: "2026-06-12T00:57:40.318Z",
        },
      ],
    });

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      sessionDetailByKey: { [`sudoku/${target.id}`]: detail },
      fileContentByKey: {
        [`sudoku/${target.id}/0087446fcc94a7fb@v2`]: "def test_auth():\n    assert True\n",
      },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickFileBadge(page, target.id);

    const fileNodeId = `${target.id}:file:backend\\tests\\test_auth.py`;
    await clickGraphNode(page, fileNodeId);

    // "File Path" (Info tab) shows the stable original tracked-file path, not the backup filename.
    await expect(page.getByLabel("File Path")).toHaveValue("backend\\tests\\test_auth.py");

    await page.getByRole("tab", { name: "Content" }).click();
    await expect(page.getByTestId("file-content")).toContainText("def test_auth():");
    await expect(page.getByTestId("file-content")).toContainText("assert True");
  });

  test("the File badge renders at the bottom-left corner, visually distinct from the bottom-right note-badge", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, fileCount: 1 }));
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      initialNotes: [
        {
          projectId: "sudoku",
          nodeType: "session",
          nodeId: target.id,
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    // Wait for the graph (and both badges) to actually render before reading positions — avoids a
    // race reading `renderedPosition()`/`boundingBox()` before Cytoscape has placed the node.
    await expect(fileBadgeLocator(page, target.id)).toBeVisible();

    const nodePos = await page.evaluate((id) => {
      const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
      return cy.getElementById(id).renderedPosition();
    }, target.id);

    const fileBadgeBox = await fileBadgeLocator(page, target.id).boundingBox();
    const noteBadgeBox = await page
      .locator(`[data-testid="note-badge"][data-node-id="${target.id}"]`)
      .boundingBox();
    if (!fileBadgeBox || !noteBadgeBox) throw new Error("badge not found");

    // File badge: left of and below the node's center (bottom-LEFT corner).
    expect(fileBadgeBox.x + fileBadgeBox.width / 2).toBeLessThan(nodePos.x);
    // Note badge: right of and below the node's center (bottom-RIGHT corner) — CR-UI-18's existing
    // contract, asserted here for contrast.
    expect(noteBadgeBox.x + noteBadgeBox.width / 2).toBeGreaterThan(nodePos.x);
    // Both sit at roughly the same height (bottom edge) but on opposite horizontal sides.
    expect(fileBadgeBox.x).toBeLessThan(noteBadgeBox.x);
  });

  test("no non-empty trackedFileBackups anywhere: no File badge, and clicking Memory/Subagent/Tool banners is unaffected (regression)", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1); // fileCount omitted -> undefined -> treated as 0/hidden
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
    await expect(fileBadgeLocator(page, target.id)).toHaveCount(0);

    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "3"); // project + session + 1 memory
  });
});
