import { SORT_OPTIONS, type SortName } from "../types";

export interface SortSwitcherProps {
  sort: SortName;
  onChange: (sort: SortName) => void;
  // CR-UI-23: disables the control (visually + functionally) when the active layout doesn't
  // consume sort order (Force-directed, Timeline) — only Hierarchical does. The stored `sort`
  // value itself is unaffected; disabling never resets it.
  disabled?: boolean;
}

export function SortSwitcher({ sort, onChange, disabled }: SortSwitcherProps) {
  return (
    <div className="sort-switcher">
      <label htmlFor="sort-select">Sort:</label>
      <select
        id="sort-select"
        value={sort}
        onChange={(e) => onChange(e.target.value as SortName)}
        aria-label="Sort"
        disabled={disabled}
        title={disabled ? "Sort only affects the Hierarchical layout" : undefined}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
