import { useState } from "react";
import type { Project } from "../types";
import { browseProject, ApiError } from "../api/client";

export interface ProjectPickerProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onProjectsAdded: (projects: Project[]) => void;
}

const BROWSE_VALUE = "__browse__";

export function ProjectPicker({
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectsAdded,
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
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.path.split(/[/\\]/).pop() ?? p.id} ({p.sessionCount} sessions)
          </option>
        ))}
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
