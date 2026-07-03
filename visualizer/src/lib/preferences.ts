import { DEFAULT_LAYOUT, DEFAULT_SORT, type LayoutName, type SortName } from "../types";

const LAYOUT_PREF_KEY = "claudeMap.preferredLayout";

function isLayoutName(value: string | null): value is LayoutName {
  return value === "cose" || value === "breadthfirst" || value === "timeline";
}

export function getPreferredLayout(): LayoutName {
  try {
    const stored = localStorage.getItem(LAYOUT_PREF_KEY);
    if (isLayoutName(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return DEFAULT_LAYOUT;
}

export function setPreferredLayout(layout: LayoutName): void {
  try {
    localStorage.setItem(LAYOUT_PREF_KEY, layout);
  } catch {
    // ignore write failures
  }
}

// CR-UI-10: sort order, orthogonal to (and persisted alongside) the layout preference.
const SORT_PREF_KEY = "claudeMap.preferredSort";

function isSortName(value: string | null): value is SortName {
  return (
    value === "date-desc" || value === "date-asc" || value === "agents-desc" || value === "agents-asc"
  );
}

export function getPreferredSort(): SortName {
  try {
    const stored = localStorage.getItem(SORT_PREF_KEY);
    if (isSortName(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return DEFAULT_SORT;
}

export function setPreferredSort(sort: SortName): void {
  try {
    localStorage.setItem(SORT_PREF_KEY, sort);
  } catch {
    // ignore write failures
  }
}

// CR-UI-11 (reopen, Sprint 5): the Detail panel's user-resized width, expressed as a **percent of
// viewport width** (was fixed px 250-800 at original ship) so the usable range scales with the
// user's actual screen/window size. Not part of the original mockup's hard requirement, but a
// low-cost, natural extension (persist the drag so it survives a reload) — see
// REQUIREMENTS/BACKLOG.md CR-UI-11.
const DETAIL_PANEL_WIDTH_PREF_KEY = "claudeMap.detailPanelWidth";
export const DETAIL_PANEL_MIN_WIDTH = 10; // percent of viewport width
export const DETAIL_PANEL_MAX_WIDTH = 80; // percent of viewport width
export const DETAIL_PANEL_DEFAULT_WIDTH = 25; // percent — sensible default, also the fallback for
// an old pre-reopen stored pixel value (see getPreferredDetailPanelWidth below)

export function clampDetailPanelWidth(percent: number): number {
  return Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, percent));
}

export function getPreferredDetailPanelWidth(): number {
  try {
    const stored = localStorage.getItem(DETAIL_PANEL_WIDTH_PREF_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      // CR-UI-11 (reopen): a pre-reopen stored value is a raw pixel number (e.g. "280"), which for
      // any real window width is nowhere near the new [10, 80] percent range — rather than
      // silently (and misleadingly) clamping it in, treat any out-of-range stored value as stale
      // and fall back to a sensible default. This is a one-time reset of a cosmetic UI preference
      // (not durable D16 data), not data loss — a real px->percent conversion isn't possible since
      // the window width at the time it was originally set was never stored.
      if (Number.isFinite(parsed) && parsed >= DETAIL_PANEL_MIN_WIDTH && parsed <= DETAIL_PANEL_MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return DETAIL_PANEL_DEFAULT_WIDTH;
}

export function setPreferredDetailPanelWidth(percent: number): void {
  try {
    localStorage.setItem(DETAIL_PANEL_WIDTH_PREF_KEY, String(clampDetailPanelWidth(percent)));
  } catch {
    // ignore write failures
  }
}

// CR-UI-07 (D23): "Show session banners" on/off toggle, defaulting on. Persisted so it survives a
// reload, with an explicit control in PreferencesPanel.tsx per D23's standing policy.
const SHOW_BANNERS_PREF_KEY = "claudeMap.showBanners";

export function getShowBanners(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_BANNERS_PREF_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return true;
}

export function setShowBanners(show: boolean): void {
  try {
    localStorage.setItem(SHOW_BANNERS_PREF_KEY, String(show));
  } catch {
    // ignore write failures
  }
}

// CR-UI-24 (Sprint 5): Light/Dark/System theme, defaulting to "system" (follows the OS preference
// via `prefers-color-scheme`, matching pre-CR behavior for anyone who never opens this setting).
export type ThemeName = "light" | "dark" | "system";

export const THEME_OPTIONS: { value: ThemeName; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const THEME_PREF_KEY = "claudeMap.preferredTheme";

function isThemeName(value: string | null): value is ThemeName {
  return value === "light" || value === "dark" || value === "system";
}

export function getPreferredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(THEME_PREF_KEY);
    if (isThemeName(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return "system";
}

export function setPreferredTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_PREF_KEY, theme);
  } catch {
    // ignore write failures
  }
}
