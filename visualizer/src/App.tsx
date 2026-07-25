import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  StickItNoteEntry,
  LayoutName,
  NodeType,
  NoteEntry,
  Project,
  ProjectGroupsResponse,
  SelectedGraphItem,
  Session,
  SortName,
  TimeRangeName,
} from "./types";
import {
  fetchProjects,
  fetchProjectGroups,
  fetchSessions,
  fetchNotes,
  fetchStickItNotes,
  ApiError,
} from "./api/client";
import {
  getPreferredLayout,
  setPreferredLayout,
  getPreferredSort,
  setPreferredSort,
  getPreferredTimeRange,
  setPreferredTimeRange,
  getPreferredDetailPanelWidth,
  setPreferredDetailPanelWidth,
  clampDetailPanelWidth,
  getShowBanners,
  setShowBanners,
  getExpandOnDoubleClick,
  setExpandOnDoubleClick,
  getPreferredTheme,
  setPreferredTheme,
  getPreferredSessionColorScheme,
  setPreferredSessionColorScheme,
  type SessionColorScheme,
  type ThemeName,
} from "./lib/preferences";
import { filterSessionsByTimeRange } from "./lib/timeRange";
import { ProjectPicker } from "./components/ProjectPicker";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { SortSwitcher } from "./components/SortSwitcher";
import { TimeRangeSwitcher } from "./components/TimeRangeSwitcher";
import { BurgerMenu } from "./components/BurgerMenu";
import { GraphCanvas } from "./components/GraphCanvas";
import { DetailPanel } from "./components/DetailPanel";
import "./App.css";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  // CR-CORE-06 (Sprint 8, D26): the Code/Cowork/Chat grouped-dropdown data — `null` until the first
  // fetch resolves (best-effort: the picker just shows Code-only until/unless it does, same
  // graceful-degradation pattern as `notes`/`stickItNotes` below).
  const [projectGroups, setProjectGroups] = useState<ProjectGroupsResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutName>(() => getPreferredLayout());
  const [sort, setSort] = useState<SortName>(() => getPreferredSort());
  // CR-UI-27 (D23): time-range filter — header control + bidirectionally-synced Preferences field.
  const [timeRange, setTimeRangeState] = useState<TimeRangeName>(() => getPreferredTimeRange());
  // CR-UI-07 (D23): banner-row visibility — Preferences-only control (no header quick shortcut).
  const [showBanners, setShowBannersState] = useState<boolean>(() => getShowBanners());
  // CR-UI-40: "Require double-click to expand/collapse" — Preferences-only control, default off.
  const [expandOnDoubleClick, setExpandOnDoubleClickState] = useState<boolean>(() =>
    getExpandOnDoubleClick(),
  );
  // CR-UI-39: a plain incrementing counter — GraphCanvas's `useEffect` watches this and clears
  // `expandedTypes` to an empty Map whenever it changes. No panel involved, so no separate "closed"
  // state to track like the burger-menu panels above.
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  // CR-UI-24 (D23): Light/Dark/System theme — Preferences-only control (no header quick shortcut).
  const [theme, setThemeState] = useState<ThemeName>(() => getPreferredTheme());
  // CR-UI-33 (D23): "Session color scheme" — Preferences-only control (no header quick shortcut).
  const [sessionColorScheme, setSessionColorSchemeState] = useState<SessionColorScheme>(() =>
    getPreferredSessionColorScheme(),
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // CR-UI-24: apply the theme by setting `document.documentElement.dataset.theme` to "light"/
  // "dark", or removing the attribute entirely for "system" — the existing `prefers-color-scheme`
  // media query then keeps controlling it, unchanged default behavior for anyone who never touches
  // this setting.
  useEffect(() => {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

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
  // CR-CORE-03 (Sprint 6): ingest-written, read-only "stick-it" notes — fetched alongside the
  // user-editable `notes` above, unioned into `notedKeys` below so a session shows one badge for
  // either kind of note, but kept in a separate array/state throughout (never merged into `notes`
  // itself) since the two are stored/edited entirely separately.
  const [stickItNotes, setStickItNotes] = useState<StickItNoteEntry[]>([]);
  const notedKeys = useMemo(
    () =>
      new Set([
        ...notes.map((n) => `${n.nodeType}:${n.nodeId}`),
        ...stickItNotes.map((n) => `${n.nodeType}:${n.nodeId}`),
      ]),
    [notes, stickItNotes],
  );

  // Load the project list once on mount.
  useEffect(() => {
    fetchProjects()
      .then((ps) => setProjects(ps))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load projects");
      });
    // CR-CORE-06: best-effort, same pattern as notes/stickItNotes below — a failed fetch just
    // leaves the picker showing Code-only groups (today's existing behavior) rather than blocking
    // the rest of the app.
    fetchProjectGroups()
      .then((g) => setProjectGroups(g))
      .catch(() => setProjectGroups(null));
  }, []);

  // Load sessions whenever the selected project changes.
  useEffect(() => {
    if (!selectedProjectId) {
      setSessions([]);
      setSelectedSessionId(null);
      setSelectedItem(null);
      setNotes([]);
      setStickItNotes([]);
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
    // CR-CORE-03: same once-per-project, best-effort fetch pattern as the user notes above.
    fetchStickItNotes(selectedProjectId)
      .then((n) => setStickItNotes(n))
      .catch(() => setStickItNotes([]));
  }, [selectedProjectId]);

  // CR-CORE-06 (Sprint 8, D26): a Cowork/Chat selection's id never appears in `projects` (Code-only,
  // unchanged scope) — fall back to `projectGroups` and synthesize a `Project`-shaped view (`name`
  // stands in for `path`; there's no real filesystem path for these, and nothing renders
  // `lastActiveAt`) so GraphCanvas/DetailPanel need no Cowork/Chat-specific branching at all, per
  // this CR's "reuse the existing per-project code path" approach.
  const selectedGroupEntry =
    projectGroups?.cowork.find((p) => p.id === selectedProjectId) ??
    projectGroups?.chat.find((p) => p.id === selectedProjectId) ??
    null;
  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ??
    (selectedGroupEntry
      ? {
          id: selectedGroupEntry.id,
          path: selectedGroupEntry.name,
          sessionCount: selectedGroupEntry.sessionCount,
          lastActiveAt: "",
        }
      : null);
  // CR-UI-27: selection lookup stays against the full unfiltered `sessions` — switching time range
  // never force-clears an existing selection, even if the selected session falls outside the newly
  // chosen range (it just temporarily isn't rendered as a node).
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  // CR-UI-27: applied before sort/layout (GraphCanvas's own `sortSessions` runs on whatever
  // `sessions` array it's given) — Timeline's date-axis normalization and Hierarchical's Sort order
  // both naturally rescale to just the filtered set as a result, with no separate wiring needed.
  const filteredSessions = useMemo(
    () => filterSessionsByTimeRange(sessions, timeRange),
    [sessions, timeRange],
  );

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

  // CR-UI-27: header TimeRangeSwitcher and Preferences' "Default time range" field are two controls
  // over the same underlying preference — changing either updates both (D23), same pattern as sort.
  function handleTimeRangeChange(next: TimeRangeName) {
    setPreferredTimeRange(next);
    setTimeRangeState(next);
  }

  function handleShowBannersChange(next: boolean) {
    setShowBanners(next);
    setShowBannersState(next);
  }

  function handleExpandOnDoubleClickChange(next: boolean) {
    setExpandOnDoubleClick(next);
    setExpandOnDoubleClickState(next);
  }

  // CR-UI-39: "Collapse All" — a direct action, identical wiring pattern to refreshProjectData
  // below (called straight from BurgerMenu's onCollapseAll prop, no intermediate state to track
  // besides the counter itself).
  function handleCollapseAll() {
    setCollapseAllSignal((c) => c + 1);
  }

  function handleThemeChange(next: ThemeName) {
    setPreferredTheme(next);
    setThemeState(next);
  }

  function handleSessionColorSchemeChange(next: SessionColorScheme) {
    setPreferredSessionColorScheme(next);
    setSessionColorSchemeState(next);
  }

  // CR-UI-08: applied optimistically from the Content tab's Save/Delete so the 📝 indicator and any
  // other note-driven UI update immediately, without a full notes refetch.
  // CR-UI-28 (Sprint 5): a note mutation on a session sub-item (subagent/memoryTouch/tool) can make
  // its *parent* session's server-computed `hasNotedDescendant` go stale — that field lives on
  // `GET .../sessions`, not the `notes` list above, so re-fetch the sessions list too (best-effort;
  // a failure here just leaves the badge one mutation behind, not a broken app).
  function handleNoteSaved(note: NoteEntry) {
    setNotes((prev) => [
      ...prev.filter((n) => !(n.nodeType === note.nodeType && n.nodeId === note.nodeId)),
      note,
    ]);
    refreshProjectData();
  }

  function handleNoteDeleted(nodeType: NodeType, nodeId: string) {
    setNotes((prev) => prev.filter((n) => !(n.nodeType === nodeType && n.nodeId === nodeId)));
    refreshProjectData();
  }

  // CR-CORE-04 (Sprint 7): generalized from the CR-UI-28 `refetchSessionsForNotedDescendant` — now
  // re-fetches both sessions and notes for the current project, shared by the note-mutation call
  // sites above and the new burger-menu Refresh action below. Also handles the case where a
  // session's backing file was deleted and the Indexer's rescan pruned it: if the currently-selected
  // session/item no longer appears in the refreshed sessions list, clear the selection so the
  // Detail/Content panels don't keep showing a now-nonexistent session's stale data.
  //
  // 2026-07-04 (CR-CORE-04 re-fix, post-Sprint-7-validation-fail): also re-fetch the full projects
  // list and merge it in, same upsert-by-id pattern as `handleProjectsAdded`. Without this, a
  // deleted session was correctly dropped from `sessions`/the graph, but the separately-cached
  // `project.sessionCount` (read by DetailPanel's "Sessions: N" and the project-picker dropdown's
  // "(N sessions)" label) never updated since `projects` was otherwise only ever fetched once on
  // mount — reproducing the CR's own original stale-count symptom. Chose the full re-fetch+merge
  // over a cheaper `sessionCount: sessions.length` patch because it also picks up `lastActiveAt`
  // and any other server-side project-level change, not just this one field.
  function refreshProjectData() {
    if (!selectedProjectId) return;
    fetchProjects()
      .then((ps) => {
        setProjects((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const p of ps) byId.set(p.id, p);
          return Array.from(byId.values());
        });
      })
      .catch(() => {
        // Best-effort — a failed project-list refetch just leaves sessionCount/lastActiveAt stale
        // until the next successful refresh, not a crash.
      });
    // CR-CORE-06: keeps a selected Cowork/Chat item's synthesized `sessionCount` (and the picker's
    // groups generally) from going stale after a mutation — same best-effort pattern as the
    // `fetchProjects` refetch above.
    fetchProjectGroups()
      .then((g) => setProjectGroups(g))
      .catch(() => {
        // Best-effort — a failed refetch just leaves the groups stale, not a crash.
      });
    fetchSessions(selectedProjectId)
      .then((s) => {
        setSessions(s);
        const stillExists = (id: string | undefined) =>
          id !== undefined && s.some((session) => session.id === id);
        if (selectedSessionId && !stillExists(selectedSessionId)) {
          setSelectedSessionId(null);
        }
        if (selectedItem?.sessionId && !stillExists(selectedItem.sessionId)) {
          setSelectedItem(null);
        }
      })
      .catch(() => {
        // Best-effort — a failed refetch just leaves sessions/selection as they were, not a crash.
      });
    fetchNotes(selectedProjectId)
      .then((n) => setNotes(n))
      .catch(() => {
        // Best-effort, same as the initial per-project fetch.
      });
  }

  // CR-UI-11 (reopen, Sprint 5): drag-to-resize the Detail panel. The handle sits between
  // `.canvas-area` (flex: 1, shrinks/grows to fill the remainder) and `.detail-panel` (width now a
  // percent of viewport width, clamped to [DETAIL_PANEL_MIN_WIDTH, DETAIL_PANEL_MAX_WIDTH] and
  // rendered via `vw` units for automatic responsive rescaling on window resize). Dragging left
  // grows the panel (mouse moves toward the canvas), dragging right shrinks it — hence
  // `startWidth - deltaPercent`. The raw pixel drag delta is converted to a percent-of-window-width
  // delta before clamping, since the stored/compared value is now a percent, not px.
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = detailPanelWidth;
      let currentWidth = startWidth;

      function handleMouseMove(moveEvent: MouseEvent) {
        const deltaPx = moveEvent.clientX - startX;
        const deltaPercent = (deltaPx / window.innerWidth) * 100;
        currentWidth = clampDetailPanelWidth(startWidth - deltaPercent);
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
          projectGroups={projectGroups}
        />
        <LayoutSwitcher layout={layout} onChange={setLayout} />
        {/* CR-UI-23: the header Sort control is disabled outside Hierarchical ("breadthfirst") —
            only that layout actually visualizes sort order (see GraphCanvas.tsx's layoutOptionsFor).
            The Preferences panel's "Default sort" field is a separate control and stays always
            editable regardless of the current layout (see PreferencesPanel below). */}
        <SortSwitcher sort={sort} onChange={handleSortChange} disabled={layout !== "breadthfirst"} />
        {/* CR-UI-27: positioned immediately after Sort, per the user's exact placement request. */}
        <TimeRangeSwitcher timeRange={timeRange} onChange={handleTimeRangeChange} />
        <BurgerMenu
          preferredLayout={layout}
          onPreferredLayoutChange={handlePreferredLayoutChange}
          preferredSort={sort}
          onPreferredSortChange={handleSortChange}
          preferredTimeRange={timeRange}
          onPreferredTimeRangeChange={handleTimeRangeChange}
          showBanners={showBanners}
          onShowBannersChange={handleShowBannersChange}
          theme={theme}
          onThemeChange={handleThemeChange}
          sessionColorScheme={sessionColorScheme}
          onSessionColorSchemeChange={handleSessionColorSchemeChange}
          expandOnDoubleClick={expandOnDoubleClick}
          onExpandOnDoubleClickChange={handleExpandOnDoubleClickChange}
          onRefresh={refreshProjectData}
          onCollapseAll={handleCollapseAll}
        />
      </header>

      {loadError && <p className="error-text banner">{loadError}</p>}

      <main className="app-main">
        <div className="canvas-area">
          {selectedProject ? (
            <>
              <GraphCanvas
                project={selectedProject}
                sessions={filteredSessions}
                layout={layout}
                sort={sort}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                showBanners={showBanners}
                onSelectItem={setSelectedItem}
                notedKeys={notedKeys}
                theme={theme}
                sessionColorScheme={sessionColorScheme}
                collapseAllSignal={collapseAllSignal}
                expandOnDoubleClick={expandOnDoubleClick}
              />
              {/* CR-UI-27: the project itself has real sessions, but none fall in the selected
                  time range — show a clear hint rather than a confusing, seemingly-empty canvas
                  (the project node alone still renders). */}
              {sessions.length > 0 && filteredSessions.length === 0 && (
                <p className="hint centered" data-testid="time-range-empty-hint">
                  No sessions in the selected time range.
                </p>
              )}
            </>
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
              stickItNotes={stickItNotes}
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
