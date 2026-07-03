import { useEffect, useState } from "react";
import type { LayoutName, Project, Session } from "./types";
import { fetchProjects, fetchSessions, ApiError } from "./api/client";
import { getPreferredLayout, setPreferredLayout } from "./lib/preferences";
import { ProjectPicker } from "./components/ProjectPicker";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
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
  const [loadError, setLoadError] = useState<string | null>(null);

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
      return;
    }
    setSelectedSessionId(null);
    fetchSessions(selectedProjectId)
      .then((s) => setSessions(s))
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Failed to load sessions");
      });
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
        <BurgerMenu preferredLayout={layout} onPreferredLayoutChange={handlePreferredLayoutChange} />
      </header>

      {loadError && <p className="error-text banner">{loadError}</p>}

      <main className="app-main">
        <div className="canvas-area">
          {selectedProject ? (
            <GraphCanvas
              project={selectedProject}
              sessions={sessions}
              layout={layout}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
            />
          ) : (
            <p className="hint centered">Select a project to view its session graph.</p>
          )}
        </div>

        {selectedProject && <DetailPanel project={selectedProject} session={selectedSession} />}
      </main>
    </div>
  );
}

export default App;
