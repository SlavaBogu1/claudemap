import { useState } from "react";
import type { NodeType, NoteEntry, Project, SelectedGraphItem, Session } from "../types";
import { openFolder } from "../api/client";
import { ContentTab } from "./ContentTab";

export interface DetailPanelProps {
  project: Project;
  session: Session | null;
  // CR-UI-11: live-resizable width in pixels, controlled by App.tsx's drag handle.
  width?: number;
  // CR-UI-08: drives the new "Content" tab — any selected graph item, plus the project's notes and
  // mutation callbacks so Save/Delete update the rest of the app (e.g. the 📝 node indicator)
  // immediately.
  selectedItem: SelectedGraphItem | null;
  notes: NoteEntry[];
  onNoteSaved: (note: NoteEntry) => void;
  onNoteDeleted: (nodeType: NodeType, nodeId: string) => void;
}

type DetailTab = "info" | "content";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function DetailPanel({
  project,
  session,
  width,
  selectedItem,
  notes,
  onNoteSaved,
  onNoteDeleted,
}: DetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("info");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [openFolderError, setOpenFolderError] = useState<string | null>(null);

  async function handleCopyPath() {
    try {
      await navigator.clipboard.writeText(project.path);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    setTimeout(() => setCopyStatus(null), 1500);
  }

  async function handleOpenFolder() {
    setOpenFolderError(null);
    try {
      await openFolder(project.id);
    } catch (err) {
      setOpenFolderError(err instanceof Error ? err.message : "Failed to open folder");
    }
  }

  return (
    <aside
      className="detail-panel"
      aria-label="Detail panel"
      style={width != null ? { width } : undefined}
    >
      <h2>Detail</h2>

      {/* CR-UI-08 (gated, approved mockup): tab strip — "Info" is today's existing fields view,
          unchanged; "Content" is new. */}
      <div className="detail-tab-strip" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "info"}
          className={tab === "info" ? "active" : undefined}
          onClick={() => setTab("info")}
        >
          Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "content"}
          className={tab === "content" ? "active" : undefined}
          onClick={() => setTab("content")}
        >
          Content
        </button>
      </div>

      {tab === "info" ? (
        <>
          <div className="detail-field">
            <label>Path:</label>
            <div className="path-row">
              <input type="text" readOnly value={project.path} aria-label="Project path" />
              <button type="button" onClick={handleCopyPath}>
                Copy
              </button>
            </div>
            {copyStatus && <span className="hint">{copyStatus}</span>}
          </div>

          <button type="button" className="open-folder-btn" onClick={handleOpenFolder}>
            Open Folder
          </button>
          {openFolderError && <p className="error-text">{openFolderError}</p>}

          <dl className="project-stats">
            <dt>Sessions:</dt>
            <dd>{project.sessionCount}</dd>
          </dl>

          {session ? (
            <div className="session-detail" data-testid="session-detail">
              <h3>Session</h3>
              <dl>
                <dt>Started:</dt>
                <dd>{formatDateTime(session.startedAt)}</dd>
                <dt>Ended:</dt>
                <dd>{formatDateTime(session.endedAt)}</dd>
                <dt>Messages:</dt>
                <dd>{session.messageCount}</dd>
                <dt>Branch:</dt>
                <dd>{session.gitBranch}</dd>
                <dt>Subagents:</dt>
                <dd>{session.subagentCount}</dd>
                <dt>Memory touched:</dt>
                <dd>{session.touchedMemory ? "Yes" : "No"}</dd>
              </dl>
              <p className="preview" data-testid="session-preview">
                {session.preview}
              </p>
            </div>
          ) : (
            <p className="hint">Select a session node to see its detail.</p>
          )}
        </>
      ) : (
        <ContentTab
          project={project}
          selectedItem={selectedItem}
          notes={notes}
          onNoteSaved={onNoteSaved}
          onNoteDeleted={onNoteDeleted}
        />
      )}
    </aside>
  );
}
