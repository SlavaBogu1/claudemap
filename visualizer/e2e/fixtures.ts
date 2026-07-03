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
  // CR-UI-07 (Sprint 3): documented Indexer v1.4 additions, backing the session banner row.
  memoryTouchCount: number;
  toolResultCount: number;
  // CR-UI-28 (Sprint 5): documented Indexer v1.8 addition. Optional here (unlike the real
  // contract's always-present field) so existing inline mock literals across the e2e suite don't
  // all need updating — an omitted value serializes as `undefined`, which the app's badge check
  // treats the same as `false`.
  hasNotedDescendant?: boolean;
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
    memoryTouchCount: i % 2 === 0 ? i % 4 : 0,
    toolResultCount: i % 5,
    hasNotedDescendant: false,
  }));
}

// CR-UI-06 (Sprint 2): mock shape for the documented Indexer v1.3 addition
// (GET /api/projects/:id/sessions/:sessionId/detail) — never a live Indexer in tests.
// CR-UI-15 (Sprint 5): subagents gained `filePath` ("Agent Path", Indexer v1.6).
export interface MockSessionDetail {
  subagents: { agentId: string; agentType: string; description: string; filePath?: string }[];
  memoryTouches: { filePath: string; name: string }[];
  overflows: { toolUseId: string; filePath: string }[];
}

export function makeSessionDetail(overrides: Partial<MockSessionDetail> = {}): MockSessionDetail {
  return { subagents: [], memoryTouches: [], overflows: [], ...overrides };
}

// CR-UI-08 (Sprint 3): mock shapes for the documented Indexer v1.5 additions — never a live
// Indexer in tests. `MockNoteEntry` mirrors `NoteEntry` (visualizer/src/types.ts) structurally
// rather than importing it, consistent with this file's existing Mock* types.
export type MockNodeType = "session" | "memoryTouch" | "subagent" | "tool" | "project";

export interface MockNoteEntry {
  projectId: string;
  nodeType: MockNodeType;
  nodeId: string;
  content: string;
  format: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockSessionContent {
  messages: { role: "user" | "assistant"; text: string; timestamp: string }[];
}

export interface MockApiOptions {
  projects: MockProject[];
  sessionsByProjectId: Record<string, MockSession[]>;
  browseResponse?: { status: number; body: unknown };
  // Keyed by "<projectId>/<sessionId>". Sessions with no entry get an all-empty detail response.
  sessionDetailByKey?: Record<string, MockSessionDetail>;
  // Keyed by "<projectId>/<sessionId>". Sessions with no entry get an empty-messages response.
  sessionContentByKey?: Record<string, MockSessionContent>;
  // Keyed by "<projectId>/<filePath>". Paths with no entry get an empty-content response.
  memoryContentByKey?: Record<string, string>;
  // CR-UI-15 (Sprint 5): keyed by "<projectId>/<filePath>". Paths with no entry get an
  // empty-messages / empty-content response, mirroring memoryContentByKey/sessionContentByKey.
  agentContentByKey?: Record<string, MockSessionContent>;
  toolContentByKey?: Record<string, string>;
  // CR-UI-25 (Sprint 5): keyed by "<projectId>". Projects with no entry get `{source: "none",
  // content: null}`.
  projectContentByKey?: Record<string, { source: string; content: string | null }>;
  // Seed notes already "saved" before the test interacts with the app.
  initialNotes?: MockNoteEntry[];
}

export interface MockApiHandle {
  openFolderCalls: string[];
  sessionsRequestCount: Record<string, number>;
  detailRequestCount: Record<string, number>;
  // CR-UI-08: live, mutated in place as the app calls PUT/DELETE on the notes endpoints — read this
  // after an interaction to assert what got persisted.
  notes: MockNoteEntry[];
}

export async function mockApi(page: Page, options: MockApiOptions): Promise<MockApiHandle> {
  const handle: MockApiHandle = {
    openFolderCalls: [],
    sessionsRequestCount: {},
    detailRequestCount: {},
    notes: [...(options.initialNotes ?? [])],
  };
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

  await page.route(`${API_BASE}/api/projects/*/sessions/*/detail`, (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/detail/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const sessionId = match ? decodeURIComponent(match[2]) : "";
    const key = `${projectId}/${sessionId}`;
    handle.detailRequestCount[key] = (handle.detailRequestCount[key] ?? 0) + 1;
    const detail = options.sessionDetailByKey?.[key] ?? makeSessionDetail();
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
  });

  await page.route(`${API_BASE}/api/projects/*/open-folder`, (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/open-folder/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    handle.openFolderCalls.push(projectId);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  // CR-UI-08 (Sprint 3) additions below — content endpoints (read-only) and the notes CRUD trio.

  await page.route(`${API_BASE}/api/projects/*/sessions/*/content`, (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/content/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const sessionId = match ? decodeURIComponent(match[2]) : "";
    const key = `${projectId}/${sessionId}`;
    const content = options.sessionContentByKey?.[key] ?? { messages: [] };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(content) });
  });

  await page.route(`${API_BASE}/api/projects/*/memory-content*`, (route: Route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/api\/projects\/([^/]+)\/memory-content/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const path = url.searchParams.get("path") ?? "";
    const key = `${projectId}/${path}`;
    const content = options.memoryContentByKey?.[key] ?? "";
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content }) });
  });

  // CR-UI-15 (Sprint 5) additions below — Agent/Tool content endpoints, identical mock treatment
  // to memory-content above.

  await page.route(`${API_BASE}/api/projects/*/agent-content*`, (route: Route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/api\/projects\/([^/]+)\/agent-content/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const path = url.searchParams.get("path") ?? "";
    const key = `${projectId}/${path}`;
    const content = options.agentContentByKey?.[key] ?? { messages: [] };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(content) });
  });

  await page.route(`${API_BASE}/api/projects/*/tool-content*`, (route: Route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/api\/projects\/([^/]+)\/tool-content/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const path = url.searchParams.get("path") ?? "";
    const key = `${projectId}/${path}`;
    const content = options.toolContentByKey?.[key] ?? "";
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content }) });
  });

  // CR-UI-25 (Sprint 5): project-level content endpoint.
  await page.route(`${API_BASE}/api/projects/*/content`, (route: Route) => {
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/content/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const content = options.projectContentByKey?.[projectId] ?? { source: "none", content: null };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(content) });
  });

  await page.route(`${API_BASE}/api/projects/*/notes`, (route: Route) => {
    if (route.request().method() !== "GET") return route.continue();
    const url = route.request().url();
    const match = url.match(/\/api\/projects\/([^/]+)\/notes/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const projectNotes = handle.notes.filter((n) => n.projectId === projectId);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projectNotes) });
  });

  await page.route(`${API_BASE}/api/projects/*/notes/*/*`, (route: Route) => {
    const req = route.request();
    const url = req.url();
    const match = url.match(/\/api\/projects\/([^/]+)\/notes\/([^/]+)\/([^/?]+)/);
    const projectId = match ? decodeURIComponent(match[1]) : "";
    const nodeType = (match ? decodeURIComponent(match[2]) : "") as MockNodeType;
    const nodeId = match ? decodeURIComponent(match[3]) : "";

    if (req.method() === "PUT") {
      const body = req.postDataJSON() as { content: string; format?: string };
      const now = new Date().toISOString();
      const existing = handle.notes.find(
        (n) => n.projectId === projectId && n.nodeType === nodeType && n.nodeId === nodeId,
      );
      const saved: MockNoteEntry = {
        projectId,
        nodeType,
        nodeId,
        content: body.content,
        format: body.format ?? "markdown",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      handle.notes = [
        ...handle.notes.filter(
          (n) => !(n.projectId === projectId && n.nodeType === nodeType && n.nodeId === nodeId),
        ),
        saved,
      ];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) });
    }

    if (req.method() === "DELETE") {
      const existed = handle.notes.some(
        (n) => n.projectId === projectId && n.nodeType === nodeType && n.nodeId === nodeId,
      );
      handle.notes = handle.notes.filter(
        (n) => !(n.projectId === projectId && n.nodeType === nodeType && n.nodeId === nodeId),
      );
      if (!existed) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "No note found" }),
        });
      }
      return route.fulfill({ status: 204 });
    }

    return route.continue();
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

// CR-UI-09 (reopen, Sprint 4): drags a graph node by a rendered-pixel delta via real mouse events
// (Cytoscape's own drag handling listens on the canvas's native DOM events, so a locator `.dragTo`
// won't work here — same reasoning as `clickGraphNode` above needing a simulated click at the
// node's real rendered position rather than a per-node DOM element).
export async function dragGraphNode(
  page: Page,
  nodeId: string,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const canvasWrapper = page.locator(".graph-canvas-wrapper");
  const box = await canvasWrapper.boundingBox();
  if (!box) throw new Error("graph canvas wrapper not found");
  const pos = await page.evaluate((id) => {
    const cy = (window as unknown as { __cy: import("cytoscape").Core }).__cy;
    const node = cy.getElementById(id);
    return node.renderedPosition();
  }, nodeId);
  const startX = box.x + pos.x;
  const startY = box.y + pos.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 10 });
  await page.mouse.up();
}

// CR-UI-07: unlike graph nodes, session banners are real HTML buttons (an overlay, not Cytoscape
// elements) — a plain Playwright click, no canvas-coordinate simulation needed.
export async function clickBanner(
  page: Page,
  sessionId: string,
  banner: "memory" | "subagent" | "tool",
): Promise<void> {
  await page
    .locator(`[data-testid="session-banner-row"][data-session-id="${sessionId}"] [data-banner="${banner}"]`)
    .click();
}

