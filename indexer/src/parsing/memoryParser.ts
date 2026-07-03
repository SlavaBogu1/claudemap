import fs from "node:fs";
import { parseMemoryFrontmatter } from "./frontmatter.js";
import type { MemoryFileRecord } from "../types.js";

export function parseMemoryFile(filePath: string, projectId: string): MemoryFileRecord {
  const content = fs.readFileSync(filePath, "utf-8");
  const fm = parseMemoryFrontmatter(content);
  return {
    projectId,
    filePath,
    name: fm.name,
    description: fm.description,
    type: fm.type
  };
}
