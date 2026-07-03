import { describe, it, expect, beforeEach } from "vitest";
import {
  getPreferredLayout,
  setPreferredLayout,
  getPreferredDetailPanelWidth,
  setPreferredDetailPanelWidth,
  clampDetailPanelWidth,
  DETAIL_PANEL_MIN_WIDTH,
  DETAIL_PANEL_MAX_WIDTH,
  DETAIL_PANEL_DEFAULT_WIDTH,
} from "./preferences";

describe("preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to cose when nothing stored", () => {
    expect(getPreferredLayout()).toBe("cose");
  });

  it("persists and returns a stored layout choice", () => {
    setPreferredLayout("breadthfirst");
    expect(getPreferredLayout()).toBe("breadthfirst");
  });

  it("persists and returns the timeline layout choice (CR-UI-05)", () => {
    setPreferredLayout("timeline");
    expect(getPreferredLayout()).toBe("timeline");
  });

  it("falls back to default for an invalid stored value", () => {
    localStorage.setItem("claudeMap.preferredLayout", "not-a-layout");
    expect(getPreferredLayout()).toBe("cose");
  });
});

// CR-UI-11 (reopen, Sprint 5): the Detail panel's resize range is a percent of viewport width
// (10-80), not a fixed pixel range.
describe("detail panel width (percent of viewport width)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("min/max are expressed as the 10/80 percent bounds", () => {
    expect(DETAIL_PANEL_MIN_WIDTH).toBe(10);
    expect(DETAIL_PANEL_MAX_WIDTH).toBe(80);
  });

  it("clampDetailPanelWidth clamps to [10, 80]", () => {
    expect(clampDetailPanelWidth(5)).toBe(10);
    expect(clampDetailPanelWidth(95)).toBe(80);
    expect(clampDetailPanelWidth(42)).toBe(42);
  });

  it("defaults to DETAIL_PANEL_DEFAULT_WIDTH when nothing stored", () => {
    expect(getPreferredDetailPanelWidth()).toBe(DETAIL_PANEL_DEFAULT_WIDTH);
  });

  it("persists and returns a stored percent value", () => {
    setPreferredDetailPanelWidth(35);
    expect(getPreferredDetailPanelWidth()).toBe(35);
  });

  it("setPreferredDetailPanelWidth clamps before persisting", () => {
    setPreferredDetailPanelWidth(999);
    expect(getPreferredDetailPanelWidth()).toBe(80);
  });

  it("an old pre-reopen stored pixel value (out of the new [10,80] range) falls back to the default, not a broken width", () => {
    localStorage.setItem("claudeMap.detailPanelWidth", "280");
    expect(getPreferredDetailPanelWidth()).toBe(DETAIL_PANEL_DEFAULT_WIDTH);
  });

  it("falls back to the default for a non-numeric stored value", () => {
    localStorage.setItem("claudeMap.detailPanelWidth", "not-a-number");
    expect(getPreferredDetailPanelWidth()).toBe(DETAIL_PANEL_DEFAULT_WIDTH);
  });
});
