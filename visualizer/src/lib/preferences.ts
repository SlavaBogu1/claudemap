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

// CR-UI-11: the Detail panel's user-resized width. Not part of the original mockup's hard
// requirement, but a low-cost, natural extension (persist the drag so it survives a reload) — see
// REQUIREMENTS/BACKLOG.md CR-UI-11.
const DETAIL_PANEL_WIDTH_PREF_KEY = "claudeMap.detailPanelWidth";
export const DETAIL_PANEL_MIN_WIDTH = 250;
export const DETAIL_PANEL_MAX_WIDTH = 800;
export const DETAIL_PANEL_DEFAULT_WIDTH = 280; // unchanged from the pre-CR-UI-11 fixed width

export function clampDetailPanelWidth(width: number): number {
  return Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, width));
}

export function getPreferredDetailPanelWidth(): number {
  try {
    const stored = localStorage.getItem(DETAIL_PANEL_WIDTH_PREF_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) return clampDetailPanelWidth(parsed);
    }
  } catch {
    // localStorage unavailable (e.g. disabled) — fall back to default
  }
  return DETAIL_PANEL_DEFAULT_WIDTH;
}

export function setPreferredDetailPanelWidth(width: number): void {
  try {
    localStorage.setItem(DETAIL_PANEL_WIDTH_PREF_KEY, String(clampDetailPanelWidth(width)));
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
