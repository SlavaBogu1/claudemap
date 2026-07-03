import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-11 (reopen, Sprint 5) acceptance criteria: the Detail panel's resize range is 10vw-80vw
// (a percent of the *viewport width*), not a fixed pixel range — so the usable range scales with
// the window size, and an old pre-reopen stored pixel value doesn't produce a broken width. All
// against a mocked API.

async function dragHandle(page: import("@playwright/test").Page, deltaX: number) {
  const handle = page.locator(".detail-resize-handle");
  const box = await handle.boundingBox();
  if (!box) throw new Error("resize handle not found");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 5 });
  await page.mouse.up();
}

test.describe("CR-UI-11 (reopen) — resizable Detail panel, percent of viewport width", () => {
  test("dragging the handle resizes the panel within 10vw-80vw of the current viewport", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    const panel = page.locator(".detail-panel");
    const before = await panel.boundingBox();
    expect(before).not.toBeNull();

    // Dragging left (negative deltaX, toward the canvas) grows the panel.
    await dragHandle(page, -80);
    const afterGrow = await panel.boundingBox();
    expect(afterGrow!.width).toBeGreaterThan(before!.width);
    expect(afterGrow!.width).toBeGreaterThanOrEqual(1280 * 0.1 - 1);
    expect(afterGrow!.width).toBeLessThanOrEqual(1280 * 0.8 + 1);

    // Dragging right (positive deltaX, toward the panel) shrinks it.
    await dragHandle(page, 120);
    const afterShrink = await panel.boundingBox();
    expect(afterShrink!.width).toBeLessThan(afterGrow!.width);
    expect(afterShrink!.width).toBeGreaterThanOrEqual(1280 * 0.1 - 1);
  });

  test("dragging past the minimum clamps at 10vw", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await dragHandle(page, 3000); // far past the min — should clamp, not go negative/zero
    const panel = page.locator(".detail-panel");
    const box = await panel.boundingBox();
    expect(box!.width).toBeCloseTo(1280 * 0.1, 0);

    const canvas = page.locator(".canvas-area");
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox!.width).toBeGreaterThan(0);
  });

  test("dragging past the maximum clamps at 80vw", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await dragHandle(page, -3000); // far past the max — should clamp
    const panel = page.locator(".detail-panel");
    const box = await panel.boundingBox();
    expect(box!.width).toBeCloseTo(1280 * 0.8, 0);
  });

  test("the resized width (as a percent) persists across a reload", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await dragHandle(page, -100);
    const panel = page.locator(".detail-panel");
    const widthAfterDrag = (await panel.boundingBox())!.width;

    await page.reload();
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    const widthAfterReload = (await panel.boundingBox())!.width;
    expect(widthAfterReload).toBeCloseTo(widthAfterDrag, 0);
  });

  test("the persisted percent remains correctly proportioned across a viewport-width change", async ({
    page,
  }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");
    await dragHandle(page, -100); // grow to some percent P of 1280px

    const panel = page.locator(".detail-panel");
    const widthAt1280 = (await panel.boundingBox())!.width;
    const percent = widthAt1280 / 1280;

    // Resize the actual browser viewport (not a drag) — the stored percent should rescale for
    // free via `vw` units, no listener needed.
    await page.setViewportSize({ width: 900, height: 800 });
    const widthAt900 = (await panel.boundingBox())!.width;
    expect(widthAt900).toBeCloseTo(900 * percent, 0);
  });

  test("an old, pre-reopen stored pixel value doesn't produce a broken width", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });
    await page.setViewportSize({ width: 1280, height: 800 });

    // Simulate a pre-reopen stored raw pixel value (e.g. "280") before the app ever loads.
    await page.addInitScript(() => {
      window.localStorage.setItem("claudeMap.detailPanelWidth", "280");
    });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    const panel = page.locator(".detail-panel");
    const box = await panel.boundingBox();
    // 280 is out of the new [10, 80] percent range — falls back to the sensible 25% default rather
    // than being misread as "280vw" (which would be absurdly wide) or clamped to 80vw.
    expect(box!.width).toBeCloseTo(1280 * 0.25, 0);
  });
});
