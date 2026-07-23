// Thin fetch wrapper for the Indexer's local HTTP API.
// Default base URL per REQUIREMENTS/SHARED_CONSTANTS.md (Indexer binds 127.0.0.1:4317).
// Override with VITE_API_BASE_URL at build time if ever needed.

import type {
  StickItNoteEntry,
  NodeType,
  NoteEntry,
  Project,
  ProjectContent,
  ProjectGroupsResponse,
  Session,
  SessionContent,
  SessionDetail,
} from "../types";

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:4317";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    if (body && typeof body.error === "string") return body.error;
    if (body && typeof body.message === "string") return body.message;
  } catch {
    // fall through to text
  }
  try {
    const text = await res.text();
    if (text) return text;
  } catch {
    // ignore
  }
  return `Request failed with status ${res.status}`;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE_URL}/api/projects`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as Project[];
}

// CR-CORE-06 (Sprint 8): documented Indexer v1.11 addition. See _API_CONTRACT/CONTRACT.md §
// GET /api/projects/project-groups. Registered on the Indexer as a static path on the same router
// as the `:id`-scoped routes — never confused with them (no bare `project-groups` segment matches
// `:id`), so this is a plain fetch, not a special case here.
export async function fetchProjectGroups(): Promise<ProjectGroupsResponse> {
  const res = await fetch(`${API_BASE_URL}/api/projects/project-groups`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as ProjectGroupsResponse;
}

export async function fetchSessions(projectId: string): Promise<Session[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/sessions`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as Session[];
}

// CR-UI-06 (Sprint 2): documented Indexer v1.3 addition (see _API_CONTRACT/CONTRACT.md once the
// Indexer publishes it — this is the ProductOwner-documented schema, built against ahead of a live
// endpoint per the Sprint 2 brief; never invent fields beyond what's documented).
export async function fetchSessionDetail(
  projectId: string,
  sessionId: string,
): Promise<SessionDetail> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/detail`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as SessionDetail;
}

export async function openFolder(projectId: string): Promise<{ ok: true }> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/open-folder`,
    { method: "POST" },
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as { ok: true };
}

// CR-UI-08 (Sprint 3): documented Indexer v1.5 additions. See _API_CONTRACT/CONTRACT.md §
// GET .../content, § GET .../memory-content, § Notes.

export async function fetchSessionContent(
  projectId: string,
  sessionId: string,
): Promise<SessionContent> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/content`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as SessionContent;
}

export async function fetchMemoryContent(
  projectId: string,
  filePath: string,
): Promise<{ content: string }> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/memory-content?path=${encodeURIComponent(filePath)}`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as { content: string };
}

// CR-UI-15 (Sprint 5): documented Indexer v1.6 additions. See _API_CONTRACT/CONTRACT.md §
// GET .../agent-content, § GET .../tool-content.

export async function fetchAgentContent(
  projectId: string,
  filePath: string,
): Promise<SessionContent> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/agent-content?path=${encodeURIComponent(filePath)}`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as SessionContent;
}

export async function fetchToolContent(
  projectId: string,
  filePath: string,
): Promise<{ content: string }> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/tool-content?path=${encodeURIComponent(filePath)}`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as { content: string };
}

// CR-CORE-05 (Sprint 8): documented Indexer v1.10 addition. See _API_CONTRACT/CONTRACT.md §
// GET .../file-content. `path` is built client-side as `{sessionId}/{backupFileName}` — the
// contract documents the server resolving this against its own `fileHistoryRoot`
// (`{sessionId}/{backupFileName}` are "exactly two segments below" it); the Visualizer never
// constructs (or needs to know) the full on-disk `file-history/` root path itself, same
// never-invent-server-config principle as every other content endpoint here.
export async function fetchFileContent(
  projectId: string,
  sessionId: string,
  backupFileName: string,
): Promise<{ content: string }> {
  const path = `${sessionId}/${backupFileName}`;
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/file-content?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as { content: string };
}

// CR-UI-25 (Sprint 5): documented Indexer v1.7 addition. See _API_CONTRACT/CONTRACT.md §
// GET .../content (project-level).
export async function fetchProjectContent(projectId: string): Promise<ProjectContent> {
  const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/content`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as ProjectContent;
}

export async function fetchNotes(projectId: string): Promise<NoteEntry[]> {
  const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/notes`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as NoteEntry[];
}

export async function saveNote(
  projectId: string,
  nodeType: NodeType,
  nodeId: string,
  content: string,
): Promise<NoteEntry> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(nodeType)}/${encodeURIComponent(nodeId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as NoteEntry;
}

export async function deleteNote(projectId: string, nodeType: NodeType, nodeId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(nodeType)}/${encodeURIComponent(nodeId)}`,
    { method: "DELETE" },
  );
  // 204 (success) is already within Response.ok's 200-299 range — only a genuine error status throws.
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
}

// CR-CORE-03 (Sprint 6): documented Indexer v1.9 addition. See _API_CONTRACT/CONTRACT.md §
// Stick-it notes. Read-only — no PUT/DELETE client for this resource, ever (ingest-written only).
export async function fetchStickItNotes(projectId: string): Promise<StickItNoteEntry[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/stick-it-notes`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as StickItNoteEntry[];
}

export async function browseProject(path: string): Promise<Project[]> {
  const res = await fetch(`${API_BASE_URL}/api/projects/browse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  const data = await res.json();
  // Contract allows either a single project object or an array of them.
  return Array.isArray(data) ? (data as Project[]) : [data as Project];
}

// CR-CORE-08 (Sprint 9): documented Indexer v1.13 addition. See _API_CONTRACT/CONTRACT.md §
// DELETE /api/projects/browse. Removes a previously-persisted custom scan root. Per the contract,
// 200 { ok: true } is returned whether or not `path` was actually persisted — a no-op removal is
// never an error, so callers don't need to special-case "already gone".
export async function removeProjectBrowseRoot(path: string): Promise<{ ok: true }> {
  const res = await fetch(`${API_BASE_URL}/api/projects/browse`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as { ok: true };
}
