import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchProjects,
  fetchSessions,
  fetchSessionDetail,
  fetchStickItNotes,
  openFolder,
  browseProject,
  ApiError,
  API_BASE_URL,
} from "./client";

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  } as unknown as Response);
}

describe("api client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetchProjects calls GET /api/projects and returns the parsed list", async () => {
    const projects = [{ id: "p1", path: "C:/x", sessionCount: 2, lastActiveAt: "2026-07-01T00:00:00Z" }];
    mockFetchOnce(projects);
    const result = await fetchProjects();
    expect(globalThis.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/projects`);
    expect(result).toEqual(projects);
  });

  it("fetchSessions calls GET /api/projects/:id/sessions", async () => {
    const sessions = [{ id: "s1", startedAt: "t", endedAt: "t2", messageCount: 1, gitBranch: "main", preview: "hi", subagentCount: 0, touchedMemory: false }];
    mockFetchOnce(sessions);
    const result = await fetchSessions("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/projects/p1/sessions`);
    expect(result).toEqual(sessions);
  });

  it("fetchSessionDetail calls GET /api/projects/:id/sessions/:sessionId/detail (CR-UI-06)", async () => {
    const detail = {
      subagents: [{ agentId: "a1", agentType: "code-review", description: "review" }],
      memoryTouches: [],
      overflows: [],
    };
    mockFetchOnce(detail);
    const result = await fetchSessionDetail("p1", "s1");
    expect(globalThis.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/projects/p1/sessions/s1/detail`);
    expect(result).toEqual(detail);
  });

  it("fetchStickItNotes calls GET /api/projects/:id/stick-it-notes (CR-CORE-03)", async () => {
    const notes = [
      {
        projectId: "p1",
        nodeType: "session",
        nodeId: "s1",
        content: "First tagged moment.",
        createdAt: "2026-07-03T12:00:00Z",
        updatedAt: "2026-07-03T12:00:00Z",
      },
    ];
    mockFetchOnce(notes);
    const result = await fetchStickItNotes("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith(`${API_BASE_URL}/api/projects/p1/stick-it-notes`);
    expect(result).toEqual(notes);
  });

  it("openFolder POSTs to the open-folder endpoint", async () => {
    mockFetchOnce({ ok: true });
    const result = await openFolder("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/projects/p1/open-folder`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("browseProject POSTs the path and normalizes a single-object response to an array", async () => {
    const project = { id: "p2", path: "C:/y", sessionCount: 0, lastActiveAt: "t" };
    mockFetchOnce(project);
    const result = await browseProject("C:/y");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/projects/browse`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "C:/y" }),
      }),
    );
    expect(result).toEqual([project]);
  });

  it("throws ApiError with the API's message on a 400 response", async () => {
    mockFetchOnce({ error: "not a valid project directory" }, { ok: false, status: 400 });
    await expect(browseProject("bad/path")).rejects.toMatchObject({
      message: "not a valid project directory",
      status: 400,
    });
  });

  it("ApiError is an instance of Error", async () => {
    mockFetchOnce({ error: "nope" }, { ok: false, status: 404 });
    try {
      await fetchProjects();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });
});
