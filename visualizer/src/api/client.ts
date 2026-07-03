// Thin fetch wrapper for the Indexer's local HTTP API.
// Default base URL per REQUIREMENTS/SHARED_CONSTANTS.md (Indexer binds 127.0.0.1:4317).
// Override with VITE_API_BASE_URL at build time if ever needed.

import type { Project, Session } from "../types";

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
