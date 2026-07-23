import { useState } from "react";
import type { Project, ProjectGroupsResponse } from "../types";
import { browseProject, removeProjectBrowseRoot, ApiError } from "../api/client";

export interface ProjectPickerProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onProjectsAdded: (projects: Project[]) => void;
  // CR-CORE-06 (Sprint 8, D26): the Code/Cowork/Chat grouped-dropdown data — optional (and treated
  // as "no Cowork/Chat groups yet") so existing callers/tests that don't know about this addition
  // keep working unchanged. Deliberately NOT the source for the "Code" group below — `projects`
  // above (already kept live via Browse/refresh) stays the single source for Code, so that existing,
  // already-working behavior is completely unaffected by this addition; only Cowork/Chat are
  // additive, sourced from here.
  projectGroups?: ProjectGroupsResponse | null;
}

const BROWSE_VALUE = "__browse__";

// CR-CORE-06: the approved mockup shows singular "(1 session)" vs plural "(N sessions)" — applied
// uniformly across all three groups (Code included) rather than only where the mockup happened to
// show a count of exactly 1.
function formatSessionCount(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

// CR-CORE-06: Cowork/Chat group entries' `name` is already a human-readable label (a resolved
// Space name / chat title) — no basename extraction needed, unlike Code's `path`-shaped `name`.
function codeProjectLabel(p: Project): string {
  return p.path.split(/[/\\]/).pop() ?? p.id;
}

export function ProjectPicker({
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectsAdded,
  projectGroups,
}: ProjectPickerProps) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // CR-UI-38: the error's own presence is the modal's visibility — no separate boolean needed,
  // since there's never a case where the modal should show without an error message to display.
  // CR-CORE-08: no "list persisted roots" endpoint exists on the Indexer (see _API_CONTRACT/
  // CONTRACT.md — only POST/DELETE .../browse). `POST /api/projects/browse`'s response already
  // returns the project(s) discovered for a given root, so roots added-via-browse this session are
  // tracked here client-side rather than fetched; a full "list all historically-persisted roots
  // since app start" isn't achievable without a new endpoint (ProductOwner-scoped judgment call,
  // see SPRINT9_REPORT.md).
  const [addedRoots, setAddedRoots] = useState<{ path: string; projects: Project[] }[]>([]);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === BROWSE_VALUE) {
      setBrowseOpen(true);
      return;
    }
    onSelectProject(value);
  }

  async function handleScan() {
    setBrowseError(null);
    setScanning(true);
    const scannedPath = browsePath.trim();
    try {
      const added = await browseProject(scannedPath);
      onProjectsAdded(added);
      setAddedRoots((prev) => [...prev.filter((r) => r.path !== scannedPath), { path: scannedPath, projects: added }]);
      setBrowsePath("");
      setBrowseOpen(false);
    } catch (err) {
      // VZ-9.2 (CR-UI-38): full error visible in the dev console in addition to the UI modal.
      console.error(err);
      if (err instanceof ApiError) {
        setBrowseError(err.message);
      } else {
        setBrowseError("Failed to scan path");
      }
    } finally {
      setScanning(false);
    }
  }

  function dismissBrowseError() {
    setBrowseError(null);
  }

  // CR-CORE-08: remove a persisted custom scan root via the new DELETE endpoint. The contract
  // returns 200 { ok: true } even for an already-removed/unknown path, so there's no "not found"
  // branch to special-case here.
  async function handleRemoveRoot(path: string) {
    setRemoveError(null);
    setRemovingPath(path);
    try {
      await removeProjectBrowseRoot(path);
      setAddedRoots((prev) => prev.filter((r) => r.path !== path));
    } catch (err) {
      console.error(err);
      if (err instanceof ApiError) {
        setRemoveError(err.message);
      } else {
        setRemoveError("Failed to remove root");
      }
    } finally {
      setRemovingPath(null);
    }
  }

  return (
    <div className="project-picker">
      <label htmlFor="project-select">Project:</label>
      <select
        id="project-select"
        value={selectedProjectId ?? ""}
        onChange={handleSelectChange}
        aria-label="Project"
      >
        <option value="" disabled>
          Select a project…
        </option>
        {/* CR-CORE-06 (D26, approved mockup): grouped via native <optgroup> — Code first (unchanged
            source/behavior, always rendered even with zero entries, same as before this CR), then
            Cowork, then Chat, matching the mockup's exact section order. Cowork/Chat are additive —
            a group with zero entries renders no <optgroup> at all (most users have no Claude Desktop
            data), same "presence-only" convention used elsewhere this sprint (CR-UI-07/CR-CORE-05's
            zero-count hiding) rather than an empty section header. */}
        <optgroup label="Code">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {codeProjectLabel(p)} ({formatSessionCount(p.sessionCount)})
            </option>
          ))}
        </optgroup>
        {projectGroups && projectGroups.cowork.length > 0 && (
          <optgroup label="Cowork">
            {projectGroups.cowork.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatSessionCount(p.sessionCount)})
              </option>
            ))}
          </optgroup>
        )}
        {projectGroups && projectGroups.chat.length > 0 && (
          <optgroup label="Chat">
            {projectGroups.chat.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatSessionCount(p.sessionCount)})
              </option>
            ))}
          </optgroup>
        )}
        <option value={BROWSE_VALUE}>Browse…</option>
      </select>

      {browseOpen && (
        <div className="browse-panel" role="dialog" aria-label="Browse for a project folder">
          <label htmlFor="browse-path-input">Path:</label>
          <input
            id="browse-path-input"
            type="text"
            value={browsePath}
            onChange={(e) => setBrowsePath(e.target.value)}
            placeholder="C:\Users\me\.claude"
          />
          <button type="button" onClick={handleScan} disabled={scanning || !browsePath.trim()}>
            Scan
          </button>
          <button type="button" onClick={() => setBrowseOpen(false)}>
            Cancel
          </button>

          {/* CR-CORE-08: roots added via Browse this session, each removable. See the addedRoots
              comment above for why this isn't a fetched "all persisted roots" list. */}
          {addedRoots.length > 0 && (
            <div className="added-roots">
              <div className="hint">Added roots:</div>
              <ul className="added-roots-list">
                {addedRoots.map((r) => (
                  <li key={r.path} className="added-roots-item">
                    <span className="added-roots-path" title={r.path}>
                      {r.path}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRoot(r.path)}
                      disabled={removingPath === r.path}
                      aria-label={`Remove ${r.path}`}
                    >
                      {removingPath === r.path ? "Removing…" : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
              {removeError && (
                <p className="error-text" role="alert">
                  {removeError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* CR-UI-38: error rendered as a dismissable overlay modal, not inline in `.browse-panel` —
          keeps the panel's own layout (input/Scan/Cancel) fixed regardless of error message length. */}
      {browseError && (
        <div className="error-backdrop" role="presentation" onClick={dismissBrowseError}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Browse error"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="error-text" role="alert">
              {browseError}
            </p>
            <button type="button" onClick={dismissBrowseError} autoFocus>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
