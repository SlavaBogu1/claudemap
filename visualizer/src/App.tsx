import { useCallback, useEffect, useMemo, useState } from "react";
import type { LayoutName, NodeType, NoteEntry, Project, SelectedGraphItem, Session, SortName } from "./types";
import { fetchProjects, fetchSessions, fetchNotes, ApiError } from "./api/client";
import {
  getPreferredLayout,
  setPreferredLayout,
  getPreferredSort,
  setPreferredSort,
  getPreferredDetailPanelWidth,
  setPreferredDetailPanelWidth,
  clampDetailPanelWidth,
  getShowBanners,
  setShowBanners,
} from "./lib/preferences";
import { ProjectPicker } from "./components/ProjectPicker";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { SortSwitcher } from "./components/SortSwitcher";
import { BurgerMenu } from "./components/BurgerMenu";
import { GraphCanvas } from "./components/GraphCanvas";
import { DetailPanel } from "./components/DetailPanel";
import "./App.css";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutName>(() => getPreferredLayout());
  const [sort, setSort] = useState<SortName>(() => getPreferredSort());
  // CR-UI-07 (D23): banner-row visibility — Preferences-only control (no header quick shortcut).
  const [showBanners, setShowBannersState] = useState<boolean>(() => getShowBanners());
  const [loadError, setLoadError] = useState<string | null>(null);

  // CR-UI-11: Detail panel width, live-resizable via the drag handle below and persisted so it
  // survives a reload.
  const [detailPanelWidth, setDetailPanelWidth] = useState<number>(() =>
    getPreferredDetailPanelWidth(),
  );

  // CR-UI-08: the currently-selected graph item (any node type, not just sessions) driving the
  // Detail panel's Content tab, and every note for the current project (fetched once per project
  // alongside sessions, so the 📝 indicator renders without a per-node request).
  const [selectedItem, setSelectedItem] = useState<SelectedGraphItem | null>(null);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const notedKeys = useMemo(
    () => new Set(notes.map((n) => `${n.nodeType}:${n.nodeId}`)),
    [notes],
  );

  // Load the project list once on mount.
  useEffect(() => {
    fetchProjects()
      .then((ps) => setProjects(ps))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load projects");
      });
  }, []);

  // Load sessions whenever the selected project changes.
  useEffect(() => {
    if (!selectedProjectId) {
      setSessions([]);
      setSelectedSessionId(null);
      setSelectedItem(null);
      setNotes([]);
      return;
    }
    setSelectedSessionId(null);
    setSelectedItem(null);
    fetchSessions(selectedProjectId)
      .then((s) => setSessions(s))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load sessions");
      });
    // CR-UI-08: fetched once per project (not per node) so the 📝 indicator works without a
    // per-node request; best-effort — a failure here shouldn't block the rest of the app, notes
    // simply won't show as indicated until the next successful fetch.
    fetchNotes(selectedProjectId)
      .then((n) => setNotes(n))
      .catch(() => setNotes([]));
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  function handleProjectsAdded(added: Project[]) {
    setProjects((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of added) byId.set(p.id, p);
      return Array.from(byId.values());
    });
    if (added.length > 0) {
      setSelectedProjectId(added[0].id);
    }
  }

  function handlePreferredLayoutChange(next: LayoutName) {
    setPreferredLayout(next);
    setLayout(next);
  }

  // CR-UI-10: header SortSwitcher and Preferences' "Default sort" field are two controls over the
  // same underlying preference — changing either updates both (D23).
  function handleSortChange(next: SortName) {
    setPreferredSort(next);
    setSort(next);
  }

  function handleShowBannersChange(next: boolean) {
    setShowBanners(next);
    setShowBannersState(next);
  }

  // CR-UI-08: applied optimistically from the Content tab's Save/Delete so the 📝 indicator and any
  // other note-driven UI update immediately, without a full notes refetch.
  function handleNoteSaved(note: NoteEntry) {
    setNotes((prev) => [
      ...prev.filter((n) => !(n.nodeType === note.nodeType && n.nodeId === note.nodeId)),
      note,
    ]);
  }

  function handleNoteDeleted(nodeType: NodeType, nodeId: string) {
    setNotes((prev) => prev.filter((n) => !(n.nodeType === nodeType && n.nodeId === nodeId)));
  }

  // CR-UI-11: drag-to-resize the Detail panel. The handle sits between `.canvas-area` (flex: 1,
  // shrinks/grows to fill the remainder) and `.detail-panel` (explicit pixel width, clamped to
  // [DETAIL_PANEL_MIN_WIDTH, DETAIL_PANEL_MAX_WIDTH]). Dragging left grows the panel (mouse moves
  // toward the canvas), dragging right shrinks it — hence `startWidth - delta`.
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = detailPanelWidth;
      let currentWidth = startWidth;

      function handleMouseMove(moveEvent: MouseEvent) {
        const delta = moveEvent.clientX - startX;
        currentWidth = clampDetailPanelWidth(startWidth - delta);
        setDetailPanelWidth(currentWidth);
      }
      function handleMouseUp() {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        setPreferredDetailPanelWidth(currentWidth);
      }

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [detailPanelWidth],
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">ClaudeMap</span>
        <ProjectPicker
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onProjectsAdded={handleProjectsAdded}
        />
        <LayoutSwitcher layout={layout} onChange={setLayout} />
        <SortSwitcher sort={sort} onChange={handleSortChange} />
        <BurgerMenu
          preferredLayout={layout}
          onPreferredLayoutChange={handlePreferredLayoutChange}
          preferredSort={sort}
          onPreferredSortChange={handleSortChange}
          showBanners={showBanners}
          onShowBannersChange={handleShowBannersChange}
        />
      </header>

      {loadError && <p className="error-text banner">{loadError}</p>}

      <main className="app-main">
        <div className="canvas-area">
          {selectedProject ? (
            <GraphCanvas
              project={selectedProject}
              sessions={sessions}
              layout={layout}
              sort={sort}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
              showBanners={showBanners}
              onSelectItem={setSelectedItem}
              notedKeys={notedKeys}
            />
          ) : (
            <p className="hint centered">Select a project to view its session graph.</p>
          )}
        </div>

        {selectedProject && (
          <>
            {/* CR-UI-11: draggable divider between the canvas and the Detail panel. */}
            <div
              className="detail-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize detail panel"
              onMouseDown={handleResizeMouseDown}
            />
            <DetailPanel
              project={selectedProject}
              session={selectedSession}
              width={detailPanelWidth}
              selectedItem={selectedItem}
              notes={notes}
              onNoteSaved={handleNoteSaved}
              onNoteDeleted={handleNoteDeleted}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
