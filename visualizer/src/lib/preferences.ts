import {
  DEFAULT_LAYOUT,
  DEFAULT_SORT,
  DEFAULT_TIME_RANGE,
  type LayoutName,
  type SortName,
  type TimeRangeName,
} from "../types";

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

// CR-UI-35 (Sprint 6): extended alongside SortName with 3 more desc/asc metric pairs.
const VALID_SORT_NAMES: readonly SortName[] = [
  "date-desc",
  "date-asc",
  "agents-desc",
  "agents-asc",
  "memory-desc",
  "memory-asc",
  "tools-desc",
  "tools-asc",
  "messages-desc",
  "messages-asc",
];

function isSortName(value: string | null): value is SortName {
  return VALID_SORT_NAMES.includes(value as SortName);
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

// CR-UI-27 (Sprint 6): time-range filter, orthogonal to (and persisted alongside) sort/layout. D23:
// this also backs the Preferences "Default time range" field, bidirectionally synced with the
// header control (same two-way pattern as CR-UI-10's sort).
const TIME_RANGE_PREF_KEY = "claudeMap.preferredTimeRange";

function isTimeRangeName(value: string | null): value is TimeRangeName {
  return value === "week" || value === "month" || value === "all";
}

export function getPreferredTimeRange(): TimeRangeName {
  try {
    const stored = localStorage.getItem(TIME_RANGE_PREF_KEY);
    if (isTimeRangeName(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return DEFAULT_TIME_RANGE;
}

export function setPreferredTimeRange(range: TimeRangeName): void {
  try {
    localStorage.setItem(TIME_RANGE_PREF_KEY, range);
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

// CR-UI-40: "Require double-click to expand/collapse" on/off toggle, defaulting off — preserves
// today's exact single-click-does-both behavior for anyone who never opens this setting. Mirrors
// getShowBanners/setShowBanners exactly.
const EXPAND_ON_DOUBLE_CLICK_PREF_KEY = "claudeMap.expandOnDoubleClick";

export function getExpandOnDoubleClick(): boolean {
  try {
    const stored = localStorage.getItem(EXPAND_ON_DOUBLE_CLICK_PREF_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return false;
}

export function setExpandOnDoubleClick(show: boolean): void {
  try {
    localStorage.setItem(EXPAND_ON_DOUBLE_CLICK_PREF_KEY, String(show));
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

// CR-UI-33 (Sprint 6): "Session color scheme" preference — recolors session node backgrounds along
// a red->green gradient by one of three metrics, instead of today's flat gray. Mirrors ThemeName's
// shape exactly. The *metric* is the user's choice here; the actual gradient *colors* follow the
// active Light/Dark theme (see GraphCanvas.tsx's LIGHT_PALETTE/DARK_PALETTE gradientLow/gradientHigh).
export type SessionColorScheme = "default" | "sizeGrad" | "timeGrad" | "durationGrad";

export const SESSION_COLOR_SCHEME_OPTIONS: { value: SessionColorScheme; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "sizeGrad", label: "Size Grad" },
  { value: "timeGrad", label: "Time Grad" },
  { value: "durationGrad", label: "Duration Grad" },
];

const SESSION_COLOR_SCHEME_PREF_KEY = "claudeMap.sessionColorScheme";

function isSessionColorScheme(value: string | null): value is SessionColorScheme {
  return value === "default" || value === "sizeGrad" || value === "timeGrad" || value === "durationGrad";
}

export function getPreferredSessionColorScheme(): SessionColorScheme {
  try {
    const stored = localStorage.getItem(SESSION_COLOR_SCHEME_PREF_KEY);
    if (isSessionColorScheme(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return "default";
}

export function setPreferredSessionColorScheme(scheme: SessionColorScheme): void {
  try {
    localStorage.setItem(SESSION_COLOR_SCHEME_PREF_KEY, scheme);
  } catch {
    // ignore write failures
  }
}
