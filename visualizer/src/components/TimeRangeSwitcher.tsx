import { TIME_RANGE_OPTIONS, type TimeRangeName } from "../types";

// CR-UI-27 (Sprint 6): mirrors SortSwitcher.tsx's structure exactly — label + <select>.

export interface TimeRangeSwitcherProps {
  timeRange: TimeRangeName;
  onChange: (range: TimeRangeName) => void;
}

export function TimeRangeSwitcher({ timeRange, onChange }: TimeRangeSwitcherProps) {
  return (
    <div className="time-range-switcher">
      <label htmlFor="time-range-select">Time range:</label>
      <select
        id="time-range-select"
        value={timeRange}
        onChange={(e) => onChange(e.target.value as TimeRangeName)}
        aria-label="Time range"
      >
        {TIME_RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
