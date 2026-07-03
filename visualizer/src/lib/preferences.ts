import { DEFAULT_LAYOUT, type LayoutName } from "../types";

const LAYOUT_PREF_KEY = "claudeMap.preferredLayout";

function isLayoutName(value: string | null): value is LayoutName {
  return value === "cose" || value === "breadthfirst";
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
