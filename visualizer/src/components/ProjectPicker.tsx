import { useState } from "react";
import type { Project, ProjectGroupsResponse } from "../types";
import { browseProject, ApiError } from "../api/client";

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
    try {
      const added = await browseProject(browsePath.trim());
      onProjectsAdded(added);
      setBrowsePath("");
      setBrowseOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setBrowseError(err.message);
      } else {
        setBrowseError("Failed to scan path");
      }
    } finally {
      setScanning(false);
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
          {browseError && <p className="error-text" role="alert">{browseError}</p>}
        </div>
      )}
    </div>
  );
}
