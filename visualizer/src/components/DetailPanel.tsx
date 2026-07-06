import { useState } from "react";
import type { StickItNoteEntry, NodeType, NoteEntry, Project, SelectedGraphItem, Session } from "../types";
import { openFolder } from "../api/client";
import { ContentTab } from "./ContentTab";

export interface DetailPanelProps {
  project: Project;
  session: Session | null;
  // CR-UI-11 (reopen, Sprint 5): live-resizable width as a percent of viewport width (10-80),
  // controlled by App.tsx's drag handle — rendered as `vw` units for automatic responsive
  // rescaling on window resize.
  width?: number;
  // CR-UI-08: drives the new "Content" tab — any selected graph item, plus the project's notes and
  // mutation callbacks so Save/Delete update the rest of the app (e.g. the 📝 node indicator)
  // immediately.
  selectedItem: SelectedGraphItem | null;
  notes: NoteEntry[];
  // CR-CORE-03: read-only, ingest-written "stick-it" notes — passed through to the Content tab's
  // view-only section, entirely separate from the editable `notes` above.
  stickItNotes: StickItNoteEntry[];
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
  stickItNotes,
  onNoteSaved,
  onNoteDeleted,
}: DetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>("info");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [openFolderError, setOpenFolderError] = useState<string | null>(null);
  // CR-UI-04 (reopen, Sprint 5): separate copy-status state for the Resume command field's own Copy
  // button (now relocated into the Info tab, below Path — the standalone Terminal tab was deleted),
  // so its "Copied"/"Copy failed" hint doesn't bleed into (or get clobbered by) the Info tab's Path
  // field above, which reuses the exact same pattern.
  const [terminalCopyStatus, setTerminalCopyStatus] = useState<string | null>(null);

  // CR-UI-15 (Sprint 5): generalizes the single "Path" field into per-item-type path fields —
  // Project Path (project/session selection, or nothing selected — unchanged data/behavior),
  // Memory Path (memory-touch — `rawId` already *is* the file path), Tool Path / Agent Path
  // (tool/subagent — `filePath`, set by GraphCanvas from `SessionDetail`'s new field, since `rawId`
  // for these two is the notes API's `nodeId`, not a file path).
  // CR-CORE-05 (Sprint 8): "File Path" added, same pattern as Memory/Tool/Agent Path above — value
  // is `rawId` (the original tracked-file path, stable across re-versioning), not `filePath`
  // (which for "file" items carries the version-specific `backupFileName` instead, needed only for
  // the content-fetch call — see `SelectedGraphItem.filePath`'s doc comment in types.ts). Not
  // called out explicitly in CR-CORE-05's own text, but a direct extension of an already-approved,
  // established pattern — flagged in the sprint report rather than silently assumed.
  const pathField =
    selectedItem?.nodeType === "memoryTouch"
      ? { label: "Memory Path", value: selectedItem.rawId }
      : selectedItem?.nodeType === "tool"
        ? { label: "Tool Path", value: selectedItem.filePath ?? "" }
        : selectedItem?.nodeType === "subagent"
          ? { label: "Agent Path", value: selectedItem.filePath ?? "" }
          : selectedItem?.nodeType === "file"
            ? { label: "File Path", value: selectedItem.rawId }
            : { label: "Project Path", value: project.path };

  async function handleCopyPath() {
    try {
      await navigator.clipboard.writeText(pathField.value);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    setTimeout(() => setCopyStatus(null), 1500);
  }

  // CR-UI-04: `claude --resume <session-id>` — always the *parent* session's id, even for a
  // sub-item selection (subagent/memoryTouch/tool; `selectedItem.sessionId` already resolves to the
  // parent for those, set by GraphCanvas — there's no per-sub-item resume concept). Purely a
  // client-side string built from an id already on hand: no process spawned, no PTY, no new Indexer
  // endpoint, no network call.
  const resumeCommand = selectedItem?.sessionId ? `claude --resume ${selectedItem.sessionId}` : null;

  async function handleCopyResumeCommand() {
    if (!resumeCommand) return;
    try {
      await navigator.clipboard.writeText(resumeCommand);
      setTerminalCopyStatus("Copied");
    } catch {
      setTerminalCopyStatus("Copy failed");
    }
    setTimeout(() => setTerminalCopyStatus(null), 1500);
  }

  async function handleOpenFolder() {
    setOpenFolderError(null);
    try {
      await openFolder(project.id);
    } catch (err) {
      setOpenFolderError(err instanceof Error ? err.message : "Failed to open folder");
    }
  }

  // CR-UI-26: the Info tab's preview area now shows the currently-selected item's note (any item
  // type), not session-content preview text — same note-lookup pattern ContentTab.tsx already uses.
  const itemNote = selectedItem
    ? (notes.find((n) => n.nodeType === selectedItem.nodeType && n.nodeId === selectedItem.rawId) ?? null)
    : null;

  function handlePreviewActivate() {
    setTab("content");
  }

  function handlePreviewKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handlePreviewActivate();
    }
  }

  return (
    <aside
      className="detail-panel"
      aria-label="Detail panel"
      style={width != null ? { width: `${width}vw` } : undefined}
    >
      <h2>Detail</h2>

      {/* CR-UI-08 (gated, approved mockup): tab strip — "Info" is today's existing fields view;
          "Content" is new. CR-UI-04 (reopen, Sprint 5): the standalone "Terminal" tab was deleted —
          exactly two tabs now. */}
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
            <label>{pathField.label}:</label>
            <div className="path-row">
              <input type="text" readOnly value={pathField.value} aria-label={pathField.label} />
              <button type="button" onClick={handleCopyPath}>
                Copy
              </button>
            </div>
            {copyStatus && <span className="hint">{copyStatus}</span>}
          </div>

          {/* CR-UI-04 (reopen, Sprint 5): relocated from the now-deleted Terminal tab, directly below
              Path — same detail-field/path-row structure, same resumeCommand/handleCopyResumeCommand/
              terminalCopyStatus logic, only where it renders changed. */}
          <div className="detail-field">
            <label>Resume command:</label>
            {resumeCommand ? (
              <>
                <div className="path-row">
                  <input type="text" readOnly value={resumeCommand} aria-label="Resume command" />
                  <button type="button" onClick={handleCopyResumeCommand}>
                    Copy
                  </button>
                </div>
                {terminalCopyStatus && <span className="hint">{terminalCopyStatus}</span>}
              </>
            ) : (
              <p className="hint">Select a session (or one of its items) to see its resume command.</p>
            )}
          </div>

          <button type="button" className="open-folder-btn" onClick={handleOpenFolder}>
            Open Folder
          </button>
          {openFolderError && <p className="error-text">{openFolderError}</p>}

          <dl className="project-stats">
            <dt>Sessions:</dt>
            <dd>{project.sessionCount}</dd>
          </dl>

          {/* CR-UI-26: repurposed preview area, top-level (any selected item type) — shows the
              item's note if one exists, else a "no notes" hint; clicking jumps to the Content tab
              where it can actually be edited. */}
          {selectedItem && (
            <div
              className="preview"
              data-testid="session-preview"
              role="button"
              tabIndex={0}
              onClick={handlePreviewActivate}
              onKeyDown={handlePreviewKeyDown}
            >
              {itemNote ? itemNote.content : "This item has no notes."}
            </div>
          )}

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
          stickItNotes={stickItNotes}
          onNoteSaved={onNoteSaved}
          onNoteDeleted={onNoteDeleted}
        />
      )}
    </aside>
  );
}
