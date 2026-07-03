import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-UI-01 acceptance criteria (VZ-1.6), all against a mocked API — never a live Indexer server.

test("renders the correct node count for a 1-session project and a 20-session project", async ({ page }) => {
  const oneSessionProject = makeProject({ id: "solo", sessionCount: 1 });
  const manySessionProject = makeProject({ id: "sudoku", sessionCount: 20 });

  await mockApi(page, {
    projects: [oneSessionProject, manySessionProject],
    sessionsByProjectId: {
      solo: makeSessions(1),
      sudoku: makeSessions(20),
    },
  });

  await page.goto("/");

  await page.getByLabel("Project", { exact: true }).selectOption("solo");
  const status = page.getByTestId("graph-status");
  await expect(status).toHaveAttribute("data-node-count", "2"); // project + 1 session

  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  await expect(status).toHaveAttribute("data-node-count", "21"); // project + 20 sessions
});

test("switching the layout dropdown re-runs Cytoscape's layout without an extra network request", async ({
  page,
}) => {
  const project = makeProject({ id: "sudoku", sessionCount: 20 });
  const handle = await mockApi(page, {
    projects: [project],
    sessionsByProjectId: { sudoku: makeSessions(20) },
  });

  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

  const status = page.getByTestId("graph-status");
  await expect(status).toHaveAttribute("data-layout", "cose");
  expect(handle.sessionsRequestCount["sudoku"]).toBe(1);

  await page.getByLabel("Layout").selectOption("breadthfirst");
  await expect(status).toHaveAttribute("data-layout", "breadthfirst");

  // No additional network request for the sessions data caused by the layout switch.
  expect(handle.sessionsRequestCount["sudoku"]).toBe(1);
});

test("clicking a session node updates the detail panel with its date/time and preview text", async ({
  page,
}) => {
  const project = makeProject({ id: "sudoku", sessionCount: 20 });
  const sessions = makeSessions(20);
  await mockApi(page, {
    projects: [project],
    sessionsByProjectId: { sudoku: sessions },
  });

  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "21");

  const target = sessions[3];
  await clickGraphNode(page, target.id);

  await expect(page.getByTestId("session-preview")).toHaveText(target.preview);
  const expectedStart = new Date(target.startedAt).toLocaleString();
  await expect(page.getByTestId("session-detail")).toContainText(expectedStart);
});

test('clicking "Open Folder" calls the open-folder endpoint with the correct project id', async ({ page }) => {
  const project = makeProject({ id: "sudoku", sessionCount: 1 });
  const handle = await mockApi(page, {
    projects: [project],
    sessionsByProjectId: { sudoku: makeSessions(1) },
  });

  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  await page.getByRole("button", { name: "Open Folder" }).click();

  await expect.poll(() => handle.openFolderCalls).toEqual(["sudoku"]);
});
