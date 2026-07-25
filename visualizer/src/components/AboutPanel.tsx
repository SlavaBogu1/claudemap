import pkg from "../../package.json";

export interface AboutPanelProps {
  // CR-UI-41: no longer called by a visible button in this panel — kept so BurgerMenu's
  // outside-click/burger-icon-click handlers still have a close path to invoke.
  onClose: () => void;
}

export function AboutPanel({ onClose: _onClose }: AboutPanelProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="About">
      {/* CR-UI-41: stops a click inside the panel from bubbling to BurgerMenu's document-level
          outside-click listener, mirroring CR-UI-38's error-modal pattern in ProjectPicker.tsx. */}
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Claude Session Explorer</h2>
        <p data-testid="app-version">Version {pkg.version}</p>
      </div>
    </div>
  );
}
