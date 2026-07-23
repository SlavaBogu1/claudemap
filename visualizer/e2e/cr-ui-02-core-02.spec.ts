import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, makeSessions, mockApi } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));

test.describe("CR-UI-02 — burger menu", () => {
  test("shows exactly 5 items: Preferences, Documentation, About, Help, Refresh (CR-UI-20, CR-CORE-04)", async ({
    page,
  }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");

    await page.getByRole("button", { name: "Menu" }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toHaveText("Preferences");
    await expect(items.nth(1)).toHaveText("Documentation");
    await expect(items.nth(2)).toHaveText("About");
    await expect(items.nth(3)).toHaveText("Help");
    await expect(items.nth(4)).toHaveText("Refresh");
  });

  test("a saved layout preference persists across reload as the initial layout", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(5) } });

    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();
    await page.getByLabel(/default graph layout/i).selectOption("breadthfirst");
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload();
    // Initial layout dropdown state should now reflect the persisted preference, not the cose default.
    await expect(page.getByLabel("Layout")).toHaveValue("breadthfirst");

    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-layout", "breadthfirst");
  });

  test("About shows a version string matching package.json", async ({ page }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "About" }).click();
    await expect(page.getByTestId("app-version")).toContainText(pkg.version);
  });

  test("Documentation opens a panel and triggers no network request", async ({ page }) => {
    await mockApi(page, { projects: [], sessionsByProjectId: {} });
    await page.goto("/");
    // Let the initial GET /api/projects (fired async from React's mount effect) fully settle before
    // attaching the listener, so it isn't misattributed to the Documentation click below.
    await page.waitForLoadState("networkidle");

    let extraRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/")) extraRequests++;
    });

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Documentation" }).click();
    await expect(page.getByRole("dialog", { name: "Documentation" })).toBeVisible();
    expect(extraRequests).toBe(0);
  });
});

test.describe("CR-CORE-02 — Browse… custom scan root", () => {
  test("submitting a valid path adds the returned project to the picker without a page reload", async ({
    page,
  }) => {
    const existing = makeProject({ id: "existing", sessionCount: 1 });
    const scanned = makeProject({ id: "exported", path: "D:\\exported\\.claude\\projects\\foo", sessionCount: 3 });

    await mockApi(page, {
      projects: [existing],
      sessionsByProjectId: { existing: makeSessions(1) },
      browseResponse: { status: 200, body: [scanned] },
    });

    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __navCount: number }).__navCount = 0;
      window.addEventListener("beforeunload", () => {
        (window as unknown as { __navCount: number }).__navCount++;
      });
    });

    await page.getByLabel("Project", { exact: true }).selectOption("__browse__");
    await page.getByLabel(/path/i).fill("D:\\exported\\.claude");
    await page.getByRole("button", { name: "Scan" }).click();

    // New project appears in the picker immediately.
    await expect(page.getByLabel("Project", { exact: true }).locator("option", { hasText: "foo" })).toHaveCount(1);

    const navCount = await page.evaluate(() => (window as unknown as { __navCount: number }).__navCount);
    expect(navCount).toBe(0);
  });

  test("shows the API's error message inline on a 400 response", async ({ page }) => {
    await mockApi(page, {
      projects: [],
      sessionsByProjectId: {},
      browseResponse: { status: 400, body: { error: "not a valid Claude project directory" } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("__browse__");
    await page.getByLabel(/path/i).fill("C:\\not\\a\\real\\path");
    await page.getByRole("button", { name: "Scan" }).click();

    await expect(page.getByRole("alert")).toHaveText("not a valid Claude project directory");
  });
});

test.describe("CR-UI-38 — Browse error modal doesn't break panel layout", () => {
  test("an invalid path shows the error in a modal overlay (not inline), leaving the input/Scan/Cancel controls in place; dismissing it allows scanning a different, valid path", async ({
    page,
  }) => {
    const scanned = makeProject({ id: "exported", path: "D:\\exported\\.claude\\projects\\foo", sessionCount: 2 });
    await mockApi(page, {
      projects: [],
      sessionsByProjectId: {},
      browseResponse: { status: 400, body: { error: "No valid Claude Code session data found" } },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("__browse__");

    const pathInput = page.getByLabel(/path/i);
    await pathInput.fill("C:\\not\\a\\real\\path");
    await page.getByRole("button", { name: "Scan" }).click();

    // Error renders in an overlay dialog, distinct from the browse panel dialog.
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText("No valid Claude Code session data found");
    await expect(alert.locator("xpath=ancestor::*[contains(@class,'modal')]")).toHaveCount(1);

    // The panel's own controls remain visible/usable while the error modal is shown.
    await expect(pathInput).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);

    // A subsequent, valid scan still works after dismissing the error (no page reload required).
    await page.route(`http://127.0.0.1:4317/api/projects/browse`, (route) => {
      if (route.request().method() === "DELETE") return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([scanned]) });
    });
    await pathInput.fill("D:\\exported\\.claude");
    await page.getByRole("button", { name: "Scan" }).click();
    await expect(page.getByLabel("Project", { exact: true }).locator("option", { hasText: "foo" })).toHaveCount(1);
  });
});

test.describe("CR-CORE-08 — remove a persisted custom scan root", () => {
  test("an added root shows a Remove button; clicking it calls DELETE and removes the root from the list without a page reload", async ({
    page,
  }) => {
    const scanned = makeProject({ id: "exported", path: "D:\\exported\\.claude\\projects\\foo", sessionCount: 2 });
    const handle = await mockApi(page, {
      projects: [],
      sessionsByProjectId: {},
      browseResponse: { status: 200, body: [scanned] },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("__browse__");
    await page.getByLabel(/path/i).fill("D:\\exported\\.claude");
    await page.getByRole("button", { name: "Scan" }).click();

    // Scanning closes the panel on success; reopen to see the added-roots list.
    // Scoped to the browse dialog itself (not a bare `getByLabel(/path/i)`) — once the scan
    // auto-selects the newly-added project, DetailPanel renders its own "Project Path" field
    // (CR-UI-15's per-item-type path field, aria-label="Project Path"), which also matches
    // a case-insensitive /path/i regex and would falsely keep the count at 1 even though the
    // browse panel itself has correctly closed.
    await expect(page.getByRole("dialog", { name: "Browse for a project folder" })).toHaveCount(0);
    await page.getByLabel("Project", { exact: true }).selectOption("__browse__");

    await expect(page.getByText("D:\\exported\\.claude")).toBeVisible();
    const removeButton = page.getByRole("button", { name: /remove d:\\exported\\\.claude/i });
    await expect(removeButton).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __navCount: number }).__navCount = 0;
      window.addEventListener("beforeunload", () => {
        (window as unknown as { __navCount: number }).__navCount++;
      });
    });

    await removeButton.click();
    await expect(page.getByText("D:\\exported\\.claude")).toHaveCount(0);

    expect(handle.browseRemoveCalls).toEqual(["D:\\exported\\.claude"]);
    const navCount = await page.evaluate(() => (window as unknown as { __navCount: number }).__navCount);
    expect(navCount).toBe(0);
  });
});
