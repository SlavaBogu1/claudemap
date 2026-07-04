// Thin fetch wrapper for the Indexer's local HTTP API.
// Default base URL per REQUIREMENTS/SHARED_CONSTANTS.md (Indexer binds 127.0.0.1:4317).
// Override with VITE_API_BASE_URL at build time if ever needed.

import type {
  ClaudeMapNoteEntry,
  NodeType,
  NoteEntry,
  Project,
  ProjectContent,
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
// Claude-map notes. Read-only — no PUT/DELETE client for this resource, ever (ingest-written only).
export async function fetchClaudeMapNotes(projectId: string): Promise<ClaudeMapNoteEntry[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/claude-map-notes`,
  );
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res), res.status);
  }
  return (await res.json()) as ClaudeMapNoteEntry[];
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
