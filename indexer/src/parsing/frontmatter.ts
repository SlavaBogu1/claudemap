// Minimal frontmatter extractor scoped to the exact shape used by this project's memory files
// (REQUIREMENTS/knowledge/CLAUDE_SESSION_FORMAT.md): `name`, `description`, `metadata.type`.
// Deliberately not a general YAML parser (avoids pulling in a new dependency for 3 flat fields).

export interface MemoryFrontmatter {
  name: string | null;
  description: string | null;
  type: string | null;
}

export function parseMemoryFrontmatter(fileContent: string): MemoryFrontmatter {
  const result: MemoryFrontmatter = { name: null, description: null, type: null };

  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return result;

  const lines = match[1].split(/\r?\n/);
  let inMetadata = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const indented = /^\s+/.test(line);
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (!indented) {
      inMetadata = trimmed.startsWith("metadata:");
      const nameMatch = trimmed.match(/^name:\s*(.*)$/);
      const descMatch = trimmed.match(/^description:\s*(.*)$/);
      if (nameMatch) result.name = stripQuotes(nameMatch[1]);
      if (descMatch) result.description = stripQuotes(descMatch[1]);
      continue;
    }

    if (inMetadata) {
      const typeMatch = trimmed.match(/^type:\s*(.*)$/);
      if (typeMatch) result.type = stripQuotes(typeMatch[1]);
    }
  }

  return result;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
