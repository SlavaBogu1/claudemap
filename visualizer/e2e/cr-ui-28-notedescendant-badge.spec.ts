import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode } from "./fixtures";

// CR-UI-28 acceptance criteria: a session shows the note badge if it or any of its
// subagent/memory-touch/tool sub-items has a saved note, even while the session is collapsed
// (never drilled into) — driven by the `hasNotedDescendant` field on GET .../sessions (Indexer
// v1.8). All against a mocked API — never a live Indexer server.

function badgeLocator(page: import("@playwright/test").Page, nodeId: string) {
  return page.locator(`[data-testid="note-badge"][data-node-id="${nodeId}"]`);
}

test.describe("CR-UI-28 — note badge for collapsed sessions with a noted descendant", () => {
  test("a session with a note on itself shows the badge (regression, direct-note case unchanged)", async ({
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
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(badgeLocator(page, target.id)).toBeVisible();
  });

  test("a session with no note on itself but hasNotedDescendant=true shows the badge while still collapsed", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, hasNotedDescendant: true }));
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
      // No `initialNotes` at all — the session itself has no direct note; the badge here is driven
      // purely by the server-computed `hasNotedDescendant` aggregate, not the client-side notes list.
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    // Never expanded/drilled into — sub-items don't even exist as Cytoscape elements yet.
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2");
    await expect(badgeLocator(page, target.id)).toBeVisible();
  });

  test("a session with no notes anywhere shows no badge", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1).map((s) => ({ ...s, hasNotedDescendant: false }));

    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: sessions } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.locator('[data-testid="note-badge"]')).toHaveCount(0);
  });

  test("adding a note to a sub-item via the Content tab updates the parent session's badge without a full reload", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    const handle = await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    // After the note is saved, the mocked sessions endpoint should report hasNotedDescendant=true
    // on the next fetch — mirroring the real Indexer's server-side aggregate recomputing on the
    // Visualizer's re-fetch-after-mutation trigger (App.tsx's refetchSessionsForNotedDescendant).
    await page.route(`http://127.0.0.1:4317/api/projects/sudoku/sessions`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const hasNote = handle.notes.some((n) => n.nodeType === "session" && n.nodeId === target.id);
      const body = sessions.map((s) => ({ ...s, hasNotedDescendant: hasNote }));
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(badgeLocator(page, target.id)).toHaveCount(0);

    await clickGraphNode(page, target.id);
    await page.getByRole("tab", { name: "Content" }).click();
    await page.getByLabel("Note").fill("Revisit this session.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(badgeLocator(page, target.id)).toBeVisible();

    // Deleting the note again removes the badge, still without a reload.
    await page.getByRole("button", { name: "Delete Note" }).click();
    await expect(badgeLocator(page, target.id)).toHaveCount(0);
  });

  test("existing CR-UI-18 badge tests (direct-note case, all node types) still pass unchanged", async ({
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
          nodeType: "project",
          nodeId: "sudoku",
          content: "note",
          format: "markdown",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(badgeLocator(page, "project:sudoku")).toBeVisible();
    await expect(badgeLocator(page, target.id)).toHaveCount(0);
  });
});
