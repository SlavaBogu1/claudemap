import { LAYOUT_OPTIONS, SORT_OPTIONS, TIME_RANGE_OPTIONS, type LayoutName, type SortName, type TimeRangeName } from "../types";
import { SESSION_COLOR_SCHEME_OPTIONS, THEME_OPTIONS, type SessionColorScheme, type ThemeName } from "../lib/preferences";

export interface PreferencesPanelProps {
  layout: LayoutName;
  onChange: (layout: LayoutName) => void;
  // CR-UI-10 (D23): default sort, same read/write-both-controls pattern as layout.
  sort: SortName;
  onSortChange: (sort: SortName) => void;
  // CR-UI-27 (D23): default time range, same bidirectional-sync pattern as sort.
  timeRange: TimeRangeName;
  onTimeRangeChange: (range: TimeRangeName) => void;
  // CR-UI-07 (D23): banner-row visibility — Preferences-only, no header quick shortcut.
  showBanners: boolean;
  onShowBannersChange: (show: boolean) => void;
  // CR-UI-24 (D23): Light/Dark/System theme — Preferences-only, no header quick shortcut (same
  // precedent as "Show session banners").
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  // CR-UI-33: "Session color scheme" — Preferences-only control (no header quick shortcut, same
  // precedent as Theme/"Show session banners").
  sessionColorScheme: SessionColorScheme;
  onSessionColorSchemeChange: (scheme: SessionColorScheme) => void;
  onClose: () => void;
}

export function PreferencesPanel({
  layout,
  onChange,
  sort,
  onSortChange,
  timeRange,
  onTimeRangeChange,
  showBanners,
  onShowBannersChange,
  theme,
  onThemeChange,
  sessionColorScheme,
  onSessionColorSchemeChange,
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
          <label htmlFor="pref-time-range-select">Default time range:</label>
          <select
            id="pref-time-range-select"
            value={timeRange}
            onChange={(e) => onTimeRangeChange(e.target.value as TimeRangeName)}
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
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
          <label htmlFor="pref-session-color-scheme-select">Session color scheme:</label>
          <select
            id="pref-session-color-scheme-select"
            value={sessionColorScheme}
            onChange={(e) => onSessionColorSchemeChange(e.target.value as SessionColorScheme)}
          >
            {SESSION_COLOR_SCHEME_OPTIONS.map((opt) => (
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
