export interface DocumentationPanelProps {
  // CR-UI-41: no longer called by a visible button in this panel — kept so BurgerMenu's
  // outside-click/burger-icon-click handlers still have a close path to invoke.
  onClose: () => void;
}

export function DocumentationPanel({ onClose: _onClose }: DocumentationPanelProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="Documentation">
      {/* CR-UI-41: stops a click inside the panel from bubbling to BurgerMenu's document-level
          outside-click listener, mirroring CR-UI-38's error-modal pattern in ProjectPicker.tsx. */}
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
