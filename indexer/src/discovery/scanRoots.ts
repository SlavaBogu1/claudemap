import fs from "node:fs";
import path from "node:path";

/**
 * Does `dir` contain at least one subdirectory that itself has a top-level *.jsonl file?
 * This is the "contains valid Claude Code session data" test used both for the default root and
 * for CR-CORE-02's browsed custom roots.
 */
function directoryHasSessionData(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(dir, entry.name);
    let subEntries: fs.Dirent[];
    try {
      subEntries = fs.readdirSync(subDir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (subEntries.some((e) => e.isFile() && e.name.endsWith(".jsonl"))) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a user-supplied path (default CLAUDE_HOME/projects, or a CR-CORE-02 browsed path) to the
 * actual "projects root" directory to scan — a directory whose immediate subdirectories are
 * project directories containing top-level session *.jsonl files.
 *
 * Accepts either:
 *  - a path that IS already such a projects root, or
 *  - a path with a `projects/` subfolder that is such a root (e.g. a whole CLAUDE_HOME-like folder).
 *
 * Returns null if neither exists / neither contains valid session data.
 */
export function resolveProjectsRoot(candidatePath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(candidatePath);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const projectsSubfolder = path.join(candidatePath, "projects");
  if (fs.existsSync(projectsSubfolder) && fs.statSync(projectsSubfolder).isDirectory()) {
    if (directoryHasSessionData(projectsSubfolder)) return projectsSubfolder;
  }

  if (directoryHasSessionData(candidatePath)) return candidatePath;

  return null;
}
