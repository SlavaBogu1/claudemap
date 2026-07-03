import pkg from "../../package.json";

export interface AboutPanelProps {
  onClose: () => void;
}

export function AboutPanel({ onClose }: AboutPanelProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="About">
      <div className="modal">
        <h2>Claude Session Explorer</h2>
        <p data-testid="app-version">Version {pkg.version}</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
