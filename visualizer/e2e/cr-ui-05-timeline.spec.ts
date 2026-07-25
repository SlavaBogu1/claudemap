import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, type MockSession } from "./fixtures";

// CR-UI-05 acceptance criteria (VZ-2.2), all against a mocked API — never a live Indexer server.

function chronologicalSessions(): MockSession[] {
  return [
    {
      id: "s-early",
      startedAt: "2026-06-20T10:00:00Z",
      endedAt: "2026-06-20T10:30:00Z",
      messageCount: 5,
      gitBranch: "main",
      preview: "earliest session",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-mid",
      startedAt: "2026-06-22T10:00:00Z",
      endedAt: "2026-06-22T10:30:00Z",
      messageCount: 5,
      gitBranch: "main",
      preview: "middle session",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
    {
      id: "s-late",
      startedAt: "2026-06-25T10:00:00Z",
      endedAt: "2026-06-25T10:30:00Z",
      messageCount: 5,
      gitBranch: "main",
      preview: "latest session",
      subagentCount: 0,
      touchedMemory: false,
      memoryTouchCount: 0,
      toolResultCount: 0,
    },
  ];
}

async function nodePosition(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((nodeId) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy.getElementById(nodeId).position();
  }, id);
}

test("selecting Timeline orders session nodes left-to-right by startedAt (monotonic)", async ({ page }) => {
  const project = makeProject({ id: "sudoku", sessionCount: 3 });
  const sessions = chronologicalSessions();
  await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  await page.getByLabel("Layout").selectOption("timeline");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");

  const xEarly = (await nodePosition(page, "s-early")).x;
  const xMid = (await nodePosition(page, "s-mid")).x;
  const xLate = (await nodePosition(page, "s-late")).x;

  expect(xEarly).toBeLessThan(xMid);
  expect(xMid).toBeLessThan(xLate);
});

test("switching to/from Timeline triggers no additional network request", async ({ page }) => {
  const project = makeProject({ id: "sudoku", sessionCount: 20 });
  const handle = await mockApi(page, {
    projects: [project],
    sessionsByProjectId: { sudoku: makeSessions(20) },
  });

  await page.goto("/");
  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  // Polled rather than a bare synchronous read: the sessions fetch is fired from a React effect
  // after selectOption's promise resolves, so under heavier parallel-worker load the request may
  // not have landed yet at this exact tick (Sprint 3 hardening — same expect.poll pattern already
  // used for the "Open Folder" side effect in cr-ui-01.spec.ts).
  await expect.poll(() => handle.sessionsRequestCount["sudoku"]).toBe(1);

  await page.getByLabel("Layout").selectOption("timeline");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");
  expect(handle.sessionsRequestCount["sudoku"]).toBe(1);

  await page.getByLabel("Layout").selectOption("cose");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "cose");
  expect(handle.sessionsRequestCount["sudoku"]).toBe(1);
});

test("1 session and 20+ sessions both render under Timeline without total node overlap", async ({ page }) => {
  const soloProject = makeProject({ id: "solo", sessionCount: 1 });
  const manyProject = makeProject({ id: "sudoku", sessionCount: 20 });
  await mockApi(page, {
    projects: [soloProject, manyProject],
    sessionsByProjectId: { solo: makeSessions(1), sudoku: makeSessions(20) },
  });

  await page.goto("/");
  await page.getByLabel("Layout").selectOption("timeline");

  await page.getByLabel("Project", { exact: true }).selectOption("solo");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
  const soloPositions = await page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy
      .nodes()
      .map((n: import("cytoscape").NodeSingular) => `${n.position().x},${n.position().y}`);
  });
  expect(new Set(soloPositions).size).toBe(soloPositions.length);

  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "21");
  const manySessionPositions = await page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return cy
      .nodes('[type = "session"]')
      .map((n: import("cytoscape").NodeSingular) => `${n.position().x},${n.position().y}`);
  });
  // No two of the 20 session nodes land on the exact same (x, y) — the shared-timestamp jitter works.
  expect(new Set(manySessionPositions).size).toBe(manySessionPositions.length);
});

test("Timeline choice persists via Preferences and applies as the initial layout on reload", async ({
  page,
}) => {
  const project = makeProject({ id: "sudoku", sessionCount: 5 });
  await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(5) } });

  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "Preferences" }).click();
  await page.getByLabel(/default graph layout/i).selectOption("timeline");
  // CR-UI-41: "Close" button removed — burger-icon click now closes an open panel.
  await page.getByRole("button", { name: "Menu" }).click();

  await page.reload();
  await expect(page.getByLabel("Layout")).toHaveValue("timeline");

  await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
  await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "timeline");
});
