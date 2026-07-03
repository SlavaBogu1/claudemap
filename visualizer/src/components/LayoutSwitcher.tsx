import { LAYOUT_OPTIONS, type LayoutName } from "../types";

export interface LayoutSwitcherProps {
  layout: LayoutName;
  onChange: (layout: LayoutName) => void;
}

export function LayoutSwitcher({ layout, onChange }: LayoutSwitcherProps) {
  return (
    <div className="layout-switcher">
      <label htmlFor="layout-select">Layout:</label>
      <select
        id="layout-select"
        value={layout}
        onChange={(e) => onChange(e.target.value as LayoutName)}
        aria-label="Layout"
      >
        {LAYOUT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
