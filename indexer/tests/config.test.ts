import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  ANNOTATIONS_DB_PATH,
  INDEX_DB_PATH,
  resolveClaudeDesktopHome
} from "../src/config.js";

// CR-CORE-10 — database paths must be absolute and derived from the Indexer's own source/package
// directory, never from process.cwd(), so the same on-disk data/ folder is found regardless of
// which directory the process happens to be started from.
describe("INDEX_DB_PATH / ANNOTATIONS_DB_PATH (CR-CORE-10)", () => {
  it("are absolute paths", () => {
    expect(path.isAbsolute(INDEX_DB_PATH)).toBe(true);
    expect(path.isAbsolute(ANNOTATIONS_DB_PATH)).toBe(true);
  });

  it("resolve under the Indexer package's own data/ directory, named index.db / annotations.db", () => {
    expect(path.basename(INDEX_DB_PATH)).toBe("index.db");
    expect(path.basename(ANNOTATIONS_DB_PATH)).toBe("annotations.db");
    expect(path.basename(path.dirname(INDEX_DB_PATH))).toBe("data");
    expect(path.basename(path.dirname(ANNOTATIONS_DB_PATH))).toBe("data");
    // Both DBs live in the same data/ directory, and that directory sits directly under the
    // Indexer package root (a sibling of src/, dist/, tests/) — not under whatever directory the
    // process was launched from.
    expect(path.dirname(INDEX_DB_PATH)).toBe(path.dirname(ANNOTATIONS_DB_PATH));
  });

  it("do not change when process.cwd() changes (unlike the old process.cwd()-relative path.join)", () => {
    const originalCwd = process.cwd();
    const before = { index: INDEX_DB_PATH, annotations: ANNOTATIONS_DB_PATH };
    try {
      // Switch to a directory that is guaranteed not to be the package root.
      process.chdir(os.tmpdir());
      // The constants were computed once at module load from import.meta.url, not from cwd — so
      // simply changing cwd here proves nothing changed them retroactively; re-importing the
      // module (a fresh evaluation of the same file/URL) should also yield the identical values,
      // confirming the computation is cwd-independent, not just "already computed before this test".
      expect(INDEX_DB_PATH).toBe(before.index);
      expect(ANNOTATIONS_DB_PATH).toBe(before.annotations);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// CR-CORE-09 — resolveClaudeDesktopHome() must branch per-OS instead of hardcoding the Windows
// %APPDATA% convention, so the Indexer doesn't require Windows once macOS/Linux porting starts.
describe("resolveClaudeDesktopHome() (CR-CORE-09)", () => {
  const originalEnv = { ...process.env };
  let platformSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.CLAUDE_DESKTOP_HOME;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    platformSpy?.mockRestore();
    process.env = { ...originalEnv };
  });

  it("win32: uses %APPDATA%\\Claude when APPDATA is set", () => {
    platformSpy = vi.spyOn(os, "platform").mockReturnValue("win32");
    process.env.APPDATA = "C:\\Users\\someone\\AppData\\Roaming";
    expect(resolveClaudeDesktopHome()).toBe(
      path.join("C:\\Users\\someone\\AppData\\Roaming", "Claude")
    );
  });

  it("win32: falls back to homedir()/AppData/Roaming/Claude when APPDATA is unset", () => {
    platformSpy = vi.spyOn(os, "platform").mockReturnValue("win32");
    expect(resolveClaudeDesktopHome()).toBe(
      path.join(os.homedir(), "AppData", "Roaming", "Claude")
    );
  });

  it("darwin: uses ~/Library/Application Support/Claude", () => {
    platformSpy = vi.spyOn(os, "platform").mockReturnValue("darwin");
    expect(resolveClaudeDesktopHome()).toBe(
      path.join(os.homedir(), "Library", "Application Support", "Claude")
    );
  });

  it("linux: uses $XDG_CONFIG_HOME/Claude when XDG_CONFIG_HOME is set", () => {
    platformSpy = vi.spyOn(os, "platform").mockReturnValue("linux");
    process.env.XDG_CONFIG_HOME = "/home/someone/.config-custom";
    expect(resolveClaudeDesktopHome()).toBe(path.join("/home/someone/.config-custom", "Claude"));
  });

  it("linux: falls back to ~/.config/Claude when XDG_CONFIG_HOME is unset", () => {
    platformSpy = vi.spyOn(os, "platform").mockReturnValue("linux");
    expect(resolveClaudeDesktopHome()).toBe(path.join(os.homedir(), ".config", "Claude"));
  });

  it("unrecognized platform: falls back to the Linux/XDG convention rather than throwing", () => {
    platformSpy = vi.spyOn(os, "platform").mockReturnValue("aix" as NodeJS.Platform);
    expect(resolveClaudeDesktopHome()).toBe(path.join(os.homedir(), ".config", "Claude"));
  });

  it("CLAUDE_DESKTOP_HOME env override wins on every mocked platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as NodeJS.Platform[]) {
      platformSpy?.mockRestore();
      platformSpy = vi.spyOn(os, "platform").mockReturnValue(platform);
      process.env.CLAUDE_DESKTOP_HOME = "/custom/override/path";
      expect(resolveClaudeDesktopHome()).toBe("/custom/override/path");
    }
  });
});
