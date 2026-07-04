import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, API_BASE } from "./fixtures";

// CR-CORE-04 acceptance criteria (Visualizer half): a new "Refresh" burger-menu item re-fetches the
// current project's sessions and notes without a full page reload, and if the currently-selected
// session/item no longer appears in the refreshed list (its backing file was deleted and the
// Indexer's rescan pruned it), the Detail/Content panel selection is cleared instead of continuing
// to show stale data. All against a mocked API — never a live Indexer.

test.describe("CR-CORE-04 — Refresh button", () => {
  test("Refresh appears in the burger menu and re-fetches sessions/notes without a full page reload", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    let sessions = makeSessions(2);

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });
    // Route override so the sessions list can change between the initial load and the Refresh click
    // (mirrors the real Indexer's rescan-on-every-GET behavior — see cr-ui-28's identical technique).
    await page.route(`${API_BASE}/api/projects/sudoku/sessions`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) });
    });

    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __navCount: number }).__navCount = 0;
      window.addEventListener("beforeunload", () => {
        (window as unknown as { __navCount: number }).__navCount++;
      });
    });
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "3"); // project + 2 sessions

    // One session's backing file is "deleted" — the next fetch reflects the pruned list.
    sessions = sessions.filter((s) => s.id !== "session-0");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();

    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2"); // project + 1 session

    const navCount = await page.evaluate(() => (window as unknown as { __navCount: number }).__navCount);
    expect(navCount).toBe(0);
  });

  test("Refresh clears a stale selection when the selected session was deleted, with no thrown error", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    let sessions = makeSessions(2);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });
    await page.route(`${API_BASE}/api/projects/sudoku/sessions`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) });
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);

    // Selection is live: the Info tab shows the selected session's own path/resume info.
    await expect(page.getByRole("tab", { name: "Info" })).toBeVisible();
    await expect(page.getByText("Select a session node to see its detail.")).toHaveCount(0);

    // The selected session's backing file is "deleted".
    sessions = sessions.filter((s) => s.id !== target.id);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();

    // Detail/Content panel falls back to the no-selection placeholder — never shows the deleted
    // session's now-stale data, and nothing throws in the process.
    await expect(page.getByText("Select a session node to see its detail.")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  // 2026-07-04 regression test (CR-CORE-04 re-fix, post-Sprint-7-validation-fail): the Detail
  // panel's "Sessions: N" and the project-picker dropdown's "(N sessions)" label both read
  // `project.sessionCount`, which is cached in `projects` state and was NOT being re-fetched by
  // `refreshProjectData()` — so both displays kept showing the stale pre-deletion count after a
  // Refresh, even though the graph/session list itself correctly shrank. Covers both display sites.
  test("Refresh updates the stale project.sessionCount shown in the Detail panel and project picker", async ({
    page,
  }) => {
    let project = makeProject({ id: "sudoku", sessionCount: 2 });
    let sessions = makeSessions(2);

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });
    // Route overrides so both the projects list and the sessions list can change between the
    // initial load and the Refresh click (same technique as the existing test above).
    await page.route(`${API_BASE}/api/projects`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([project]) });
    });
    await page.route(`${API_BASE}/api/projects/sudoku/sessions`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) });
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    // Sanity check: both displays show the pre-deletion count before any Refresh.
    await expect(page.getByRole("option", { name: /sudoku \(2 sessions\)/ })).toHaveCount(1);
    await expect(page.locator(".project-stats dd")).toHaveText("2");

    // One session's backing file is "deleted" server-side, and the Indexer's rescan (confirmed
    // correct, see BACKLOG.md CR-CORE-04) now reports both a pruned sessions list AND an updated
    // project.sessionCount — mirroring the real Indexer, where both endpoints reflect disk truth.
    sessions = sessions.filter((s) => s.id !== "session-0");
    project = { ...project, sessionCount: 1 };

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();

    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "2"); // project + 1 session
    await expect(page.getByRole("option", { name: /sudoku \(1 sessions\)/ })).toHaveCount(1);
    await expect(page.locator(".project-stats dd")).toHaveText("1");
  });

  test("Refresh on an unrelated still-existing session leaves the selection untouched", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 2 });
    const sessions = makeSessions(2);
    const target = sessions[1];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    await expect(page.getByText("Select a session node to see its detail.")).toHaveCount(0);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();

    // Nothing was deleted server-side — the selection survives the refresh.
    await expect(page.getByText("Select a session node to see its detail.")).toHaveCount(0);
  });
});
