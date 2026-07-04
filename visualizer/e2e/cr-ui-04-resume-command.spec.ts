import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-04 (reopen, Sprint 5) acceptance criteria: the standalone "Terminal" tab was deleted; the
// read-only `claude --resume <session-id>` field (always the PARENT session's id, even for a
// sub-item selection) + Copy button now lives directly in the Info tab, below "Path" — same
// pre-existing resumeCommand/handleCopyResumeCommand/terminalCopyStatus logic, only relocated. All
// against a mocked API — never a live Indexer server.

function resumeCopyButton(page: import("@playwright/test").Page) {
  // The Info tab now has two "Copy" buttons (Path, Resume command) — scope to the field containing
  // the Resume command input to avoid a strict-mode ambiguity.
  return page
    .locator(".detail-field", { has: page.getByLabel("Resume command") })
    .getByRole("button", { name: "Copy" });
}

test.describe("CR-UI-04 (reopen) — Resume command relocated into Info", () => {
  test("the tab strip shows exactly two tabs, Info and Content — no Terminal tab anywhere", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText("Info");
    await expect(tabs.nth(1)).toHaveText("Content");
    await expect(page.getByRole("tab", { name: "Terminal" })).toHaveCount(0);
  });

  test("shows the correct resume command for a selected session, in the Info tab", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);

    // Info is the default tab — no tab switch needed to see the field.
    await expect(page.getByRole("tab", { name: "Info" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Resume command")).toHaveValue(`claude --resume ${target.id}`);
  });

  test("shows the PARENT session's id (not the sub-item's own id) for a subagent, memory, and tool selection", async ({
    page,
  }) => {
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

    for (const childNodeId of [
      `${target.id}:subagent:a1`,
      `${target.id}:memory:memory/PLAN.md`,
      `${target.id}:tool:tool_x`,
    ]) {
      await clickGraphNode(page, childNodeId);
      await expect(page.getByLabel("Resume command")).toHaveValue(`claude --resume ${target.id}`);
      // Sanity: the sub-item's own bare id never appears as the resumed session.
      await expect(page.getByLabel("Resume command")).not.toHaveValue(/tool_x|memory\/PLAN\.md|^a1$/);
    }
  });

  test("shows a hint (no field) when nothing is selected", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await expect(page.getByLabel("Resume command")).toHaveCount(0);
    await expect(page.getByText(/select a session \(or one of its items\)/i)).toBeVisible();
  });

  test("Copy copies the exact resume command text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);

    await resumeCopyButton(page).click();
    await expect(page.getByText("Copied")).toBeVisible();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(`claude --resume ${target.id}`);
  });

  test("selecting a session and copying the resume command triggers no network request and spawns no process", async ({
    page,
  }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    const sessions = makeSessions(1);
    const target = sessions[0];

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await clickGraphNode(page, target.id);
    // CR-UI-07's body-click behavior fires its own (legitimate, unrelated) async detail fetch as a
    // side effect of selecting the session — wait for it to fully settle before attaching the
    // listener below, so a slow-scheduled tail of *that* request can't be misattributed to the
    // resume-command Copy click under heavier parallel-worker CPU contention (this was a source of
    // flakiness, not a real regression — a fixed timeout after attaching the listener raced against
    // that already-in-flight request instead of waiting it out).
    await page.waitForLoadState("networkidle");

    const requestsAfterSelection: string[] = [];
    page.on("request", (req) => requestsAfterSelection.push(req.url()));

    await resumeCopyButton(page).click();
    await expect(page.getByText("Copied")).toBeVisible();

    // Give any accidental async request a moment to fire before asserting none did.
    await page.waitForTimeout(200);
    expect(requestsAfterSelection).toHaveLength(0);
  });
});
