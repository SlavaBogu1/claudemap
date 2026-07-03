import { describe, it, expect, beforeEach } from "vitest";
import { getPreferredLayout, setPreferredLayout } from "./preferences";

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

  it("falls back to default for an invalid stored value", () => {
    localStorage.setItem("claudeMap.preferredLayout", "not-a-layout");
    expect(getPreferredLayout()).toBe("cose");
  });
});
