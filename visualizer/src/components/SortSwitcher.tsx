import { SORT_OPTIONS, type SortName } from "../types";

export interface SortSwitcherProps {
  sort: SortName;
  onChange: (sort: SortName) => void;
}

export function SortSwitcher({ sort, onChange }: SortSwitcherProps) {
  return (
    <div className="sort-switcher">
      <label htmlFor="sort-select">Sort:</label>
      <select
        id="sort-select"
        value={sort}
        onChange={(e) => onChange(e.target.value as SortName)}
        aria-label="Sort"
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
