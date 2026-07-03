import { LAYOUT_OPTIONS, SORT_OPTIONS, type LayoutName, type SortName } from "../types";
import { THEME_OPTIONS, type ThemeName } from "../lib/preferences";

export interface PreferencesPanelProps {
  layout: LayoutName;
  onChange: (layout: LayoutName) => void;
  // CR-UI-10 (D23): default sort, same read/write-both-controls pattern as layout.
  sort: SortName;
  onSortChange: (sort: SortName) => void;
  // CR-UI-07 (D23): banner-row visibility — Preferences-only, no header quick shortcut.
  showBanners: boolean;
  onShowBannersChange: (show: boolean) => void;
  // CR-UI-24 (D23): Light/Dark/System theme — Preferences-only, no header quick shortcut (same
  // precedent as "Show session banners").
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  onClose: () => void;
}

export function PreferencesPanel({
  layout,
  onChange,
  sort,
  onSortChange,
  showBanners,
  onShowBannersChange,
  theme,
  onThemeChange,
  onClose,
}: PreferencesPanelProps) {
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
        <div className="pref-field">
          <label htmlFor="pref-sort-select">Default sort:</label>
          <select
            id="pref-sort-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortName)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pref-field">
          <label htmlFor="pref-theme-select">Theme:</label>
          <select
            id="pref-theme-select"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeName)}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pref-field">
          <label htmlFor="pref-show-banners">
            <input
              id="pref-show-banners"
              type="checkbox"
              checked={showBanners}
              onChange={(e) => onShowBannersChange(e.target.checked)}
            />
            Show session banners
          </label>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
