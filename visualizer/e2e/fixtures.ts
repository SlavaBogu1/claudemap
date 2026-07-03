import type { Page, Route } from "@playwright/test";

export const API_BASE = "http://127.0.0.1:4317";

export interface MockProject {
  id: string;
  path: string;
  sessionCount: number;
  lastActiveAt: string;
}

export interface MockSession {
  id: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  gitBranch: string;
  preview: string;
  subagentCount: number;
  touchedMemory: boolean;
}

export function makeProject(overrides: Partial<MockProject> = {}): MockProject {
  return {
    id: "sudoku",
    path: "C:\\Users\\me\\repos\\sudoku",
    sessionCount: 1,
    lastActiveAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

export function makeSessions(count: number): MockSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i}`,
    startedAt: `2026-06-${String(20 + (i % 8)).padStart(2, "0")}T15:45:00Z`,
    endedAt: `2026-06-${String(20 + (i % 8)).padStart(2, "0")}T16:30:00Z`,
    messageCount: 100 + i,
    gitBranch: "main",
    preview: `Session ${i} preview text — implemented feature ${i}.`,
    subagentCount: i % 3,
    touchedMemory: i % 2 === 0,
  }));
}

export interface MockApiOptions {
  projects: MockProject[];
  sessionsByProjectId: Record<string, MockSession[]>;
  browseResponse?: { status: number; body: unknown };
}

export interface MockApiHandle {
  openFolderCalls: string[];
  sessionsRequestCount: Record<string, number>;
}

export async function mockApi(page: Page, options: MockApiOptions): Promise<MockApiHandle> {
  const handle: MockApiHandle = { openFolderCalls: [], sessionsRequestCount: {} };
  let projects = options.projects;

  await page.route(`${API_BASE}/api/projects`, (route: Route) => {
    if (route.request().method() !== "GET") return route.continue();
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects) });
  });

  await page.route(`${API_BASE}/api/projects/browse`, (route: Route) => {
    const resp = options.browseResponse ?? { status: 200, body: [] };
    if (resp.status >= 200 && resp.status < 300) {
      const added = Array.isArray(resp.body) ? (resp.body as MockProject[]) : [resp.body as MockProject];
      projects = [...projects, ...added];
    }
    route.fulfill({
      status: resp.status,
      contentType: "application/json",
      body: JSON.stringify(resp.body),
    });
  });

  await page.route(`${API_BASE}/api/projects/*/sessions`, (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/sessions/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    handle.sessionsRequestCount[projectId] = (handle.sessionsRequestCount[projectId] ?? 0) + 1;
    const sessions = options.sessionsByProjectId[projectId] ?? [];
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) });
  });

  await page.route(`${API_BASE}/api/projects/*/open-folder`, (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/open-folder/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    handle.openFolderCalls.push(projectId);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  return handle;
}

// Cytoscape renders to <canvas> with no per-node DOM, so a "click on node X" has to be simulated as
// a real mouse click at that node's actual rendered position (read from the __cy test hook exposed
// by GraphCanvas), rather than guessing pixel coordinates from a layout algorithm's output.
export async function clickGraphNode(page: Page, nodeId: string): Promise<void> {
  const canvasWrapper = page.locator(".graph-canvas-wrapper");
  const box = await canvasWrapper.boundingBox();
  if (!box) throw new Error("graph canvas wrapper not found");
  const pos = await page.evaluate((id) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const node = cy.getElementById(id);
    return node.renderedPosition();
  }, nodeId);
  await page.mouse.click(box.x + pos.x, box.y + pos.y);
}

