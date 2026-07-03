import { test, expect } from "@playwright/test";
import { makeProject, makeSessions, mockApi } from "./fixtures";

// CR-UI-11 acceptance criteria (VZ-3.6/3.7): the Detail panel is resizable via a drag handle,
// clamped to [250px, 800px], persisted across reload. All against a mocked API.

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

test.describe("CR-UI-11 — resizable Detail panel", () => {
  test("dragging the handle resizes the panel within 250-800px", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    const panel = page.locator(".detail-panel");
    const before = await panel.boundingBox();
    expect(before).not.toBeNull();

    // Dragging left (negative deltaX, toward the canvas) grows the panel.
    await dragHandle(page, -80);
    const afterGrow = await panel.boundingBox();
    expect(afterGrow!.width).toBeGreaterThan(before!.width);
    expect(afterGrow!.width).toBeGreaterThanOrEqual(250);
    expect(afterGrow!.width).toBeLessThanOrEqual(800);

    // Dragging right (positive deltaX, toward the panel) shrinks it.
    await dragHandle(page, 120);
    const afterShrink = await panel.boundingBox();
    expect(afterShrink!.width).toBeLessThan(afterGrow!.width);
    expect(afterShrink!.width).toBeGreaterThanOrEqual(250);
  });

  test("dragging past the minimum clamps at 250px", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await dragHandle(page, 2000); // far past the min — should clamp, not go negative/zero
    const panel = page.locator(".detail-panel");
    const box = await panel.boundingBox();
    expect(box!.width).toBeCloseTo(250, 0);

    const canvas = page.locator(".canvas-area");
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox!.width).toBeGreaterThan(0);
  });

  test("dragging past the maximum clamps at 800px", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

    await page.goto("/");
    await page.getByLabel("Project", { exact: true }).selectOption("sudoku");

    await dragHandle(page, -2000); // far past the max — should clamp
    const panel = page.locator(".detail-panel");
    const box = await panel.boundingBox();
    expect(box!.width).toBeCloseTo(800, 0);
  });

  test("the resized width persists across a reload", async ({ page }) => {
    const project = makeProject({ id: "sudoku", sessionCount: 1 });
    await mockApi(page, { projects: [project], sessionsByProjectId: { sudoku: makeSessions(1) } });

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
});
