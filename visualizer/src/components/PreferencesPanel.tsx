import { LAYOUT_OPTIONS, type LayoutName } from "../types";

export interface PreferencesPanelProps {
  layout: LayoutName;
  onChange: (layout: LayoutName) => void;
  onClose: () => void;
}

export function PreferencesPanel({ layout, onChange, onClose }: PreferencesPanelProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="Preferences">
      <div className="modal">
        <h2>Preferences</h2>
        <div className="pref-field">
          <label htmlFor="pref-layout-select">Default graph layout:</label>
          <select
            id="pref-layout-select"
            value={layout}
            onChange={(e) => onChange(e.target.value as LayoutName)}
          >
            {LAYOUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
