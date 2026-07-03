export interface DocumentationPanelProps {
  onClose: () => void;
}

export function DocumentationPanel({ onClose }: DocumentationPanelProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="Documentation">
      <div className="modal">
        <h2>Documentation</h2>
        <div className="docs-content">
          <h3>Getting started</h3>
          <ol>
            <li>Pick a project from the "Project" dropdown, or use "Browse…" to scan a custom folder.</li>
            <li>The graph shows the project and one node per session.</li>
            <li>Click a session node to see its detail — start/end time, message count, branch, and a content preview.</li>
            <li>Use the "Layout" dropdown to switch between force-directed and hierarchical arrangements.</li>
            <li>Use "Open Folder" in the detail panel to open the project's real folder on disk.</li>
          </ol>
          <h3>Preferences</h3>
          <p>
            Set your preferred default layout from the burger menu — it will be used the next time you
            load the app.
          </p>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
