import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi, clickGraphNode, clickBanner, makeSessionDetail } from "./fixtures";

// CR-UI-06 acceptance criteria (VZ-2.4), all against a mocked
// GET /api/projects/:id/sessions/:sessionId/detail — never a live Indexer server.
//
// CR-UI-07 (Sprint 3) changed how drill-down is triggered: clicking the session node body no
// longer expanded children (that was made exclusively a per-banner action) — see
// cr-ui-07-banners.spec.ts for the full per-type banner behavior. These tests trigger expansion via
// the banners, while still covering CR-UI-06's original substructure/visual-treatment guarantees.
//
// CR-UI-07 (reopen, Sprint 4): body-click expand-all/collapse-all is restored as an ADDITION
// alongside the per-banner toggles (not a replacement) — see the inverted regression test below and
// cr-ui-07-banners.spec.ts for the full body-click behavior matrix.

async function nodeTypeCounts(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    return {
      subagent: cy.nodes('[type = "subagent"]').length,
      memory: cy.nodes('[type = "memory"]').length,
      // CR-UI-14 (Sprint 3): renamed from "overflow" — same underlying drill-down data.
      tool: cy.nodes('[type = "tool"]').length,
    };
  });
}

test.describe("CR-UI-06 — session-substructure drill-down", () => {
  test("clicking all three banners for a session with 2 subagents + 1 memory touch + 1 tool result adds exactly 4 child nodes with distinct visual treatment per type", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    const sessions = makeSessions(5);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [
        { agentId: "a1", agentType: "code-review", description: "reviewed the diff" },
        { agentId: "a2", agentType: "test-gen", description: "generated tests" },
      ],
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
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // project + 5 sessions

    await clickBanner(page, target.id, "subagent");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "8"); // + 2 subagents
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "9"); // + 1 memory
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "10"); // + 1 tool

    expect(await nodeTypeCounts(page)).toEqual({ subagent: 2, memory: 1, tool: 1 });
  });

  test("clicking a banner again collapses only that type's children", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    const sessions = makeSessions(5);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "code-review", description: "reviewed the diff" }],
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
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");

    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "memory");
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "9"); // + 3 children
    expect(await nodeTypeCounts(page)).toEqual({ subagent: 1, memory: 1, tool: 1 });

    // Collapsing the memory banner removes only the memory child, leaving the other two.
    await clickBanner(page, target.id, "memory");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "8");
    expect(await nodeTypeCounts(page)).toEqual({ subagent: 1, memory: 0, tool: 1 });

    await clickBanner(page, target.id, "subagent");
    await clickBanner(page, target.id, "tool");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6"); // back to baseline
    expect(await nodeTypeCounts(page)).toEqual({ subagent: 0, memory: 0, tool: 0 });
  });

  test("a session with no substructure: clicking a banner adds zero child nodes and shows no error", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    const sessions = makeSessions(5);
    const target = sessions[0];
    // No sessionDetailByKey entry -> mockApi's default all-empty detail response.

    await mockApi(page, {
      projects: [project],
      sessionsByProjectId: { sudoku: sessions },
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");

    await clickBanner(page, target.id, "memory");
    // No new nodes...
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");
    expect(await nodeTypeCounts(page)).toEqual({ subagent: 0, memory: 0, tool: 0 });
    // ...and no error state surfaced anywhere in the app.
    await expect(page.locator(".error-text")).toHaveCount(0);
  });

  test("CR-UI-07 (reopen) — inverted regression: clicking the session node body now toggles expand-all/collapse-all across all 3 drill-down types", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 5 });
    const sessions = makeSessions(5);
    const target = sessions[0];
    const detail = makeSessionDetail({
      subagents: [{ agentId: "a1", agentType: "code-review", description: "reviewed the diff" }],
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
    // Timeline mode keeps drill-down children well clear of the session's own footprint (a fixed
    // y-offset row below it) — deterministic, unlike the default force-directed layout where a
    // freshly-added child could physically land on top of the session node and steal the second
    // click below.
    await page.getByLabel("Layout").selectOption("timeline");
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");

    await clickGraphNode(page, target.id);
    // Detail panel updates (selection still works)... CR-UI-26 (Sprint 5): "session-preview" now
    // shows the item's note (or "no notes"), not session.preview.
    await expect(page.getByTestId("session-preview")).toHaveText("This item has no notes.");
    // ...and all 3 drill-down types expand (restored Sprint-4 behavior).
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "9");
    expect(await nodeTypeCounts(page)).toEqual({ subagent: 1, memory: 1, tool: 1 });

    // Clicking the body again collapses all 3 back to baseline.
    await clickGraphNode(page, target.id);
    await expect(page.getByTestId("graph-status")).toHaveAttribute("data-node-count", "6");
    expect(await nodeTypeCounts(page)).toEqual({ subagent: 0, memory: 0, tool: 0 });
  });
});
