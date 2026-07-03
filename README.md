# Claude Session Explorer

A local tool that indexes your [Claude Code](https://claude.com/claude-code) session transcripts,
project memory files, and git activity, then renders them as a navigable graph — so you can find and
revisit valuable work across many long-running sessions instead of losing track of it.

Everything runs entirely on your own machine. No data leaves your computer.

## What it does

Claude Code sessions accumulate fast — dozens of chats per project, each with subagent runs, memory
writes, and decisions buried in the transcript. Claude Session Explorer scans your
`~/.claude/projects/` directory, parses every session's structure, and gives you a visual map:

- **Project → session graph** — pick a project, see every session as a node, positioned by a
  switchable layout (force-directed or hierarchical).
- **Session detail** — click a session to see when it happened, how many messages it had, its git
  branch, subagent count, and a content preview.
- **Custom scan roots** — point the tool at any folder containing Claude Code session data (e.g. an
  exported `.claude` directory from another machine), not just the default location.
- **Open in Explorer** — jump straight to a project's real folder on disk from the graph.

## Architecture

Two local services, no external dependencies:

| Component | Stack | Role |
|---|---|---|
| **Indexer** (`indexer/`) | Node.js · TypeScript · Express · better-sqlite3 | Parses session/memory files into a local SQLite index; serves a read-only HTTP API on `127.0.0.1:4317` |
| **Visualizer** (`visualizer/`) | TypeScript · React · Vite · Cytoscape.js | Browser app that renders the graph and consumes the Indexer's API |

The Indexer's database is a rebuildable cache — delete it any time and it re-parses from your session
files. User-added scan roots are stored separately so they survive a cache rebuild.

## Running locally

Two terminals:

```bash
# Terminal 1 — Indexer (backend API)
cd indexer
npm install
npm run dev
# → http://127.0.0.1:4317
```

```bash
# Terminal 2 — Visualizer (frontend)
cd visualizer
npm install
npm run dev
# → http://localhost:5173
```

Open **http://localhost:5173** in your browser. The project picker populates from your real
`~/.claude/projects/` directory.

> The Indexer only accepts requests from `http://localhost:5173` / `http://127.0.0.1:5173` (CORS
> allowlist). If your Vite dev server starts on a different port, update `ALLOWED_ORIGINS` in
> `indexer/src/config.ts`.

## Development

```bash
cd indexer
npm test            # vitest
npm run test:e2e    # Playwright (real browser, real CORS checks)
npm run build

cd visualizer
npm test            # vitest
npm run test:e2e    # Playwright
npm run build
```

## Status

Early-stage — the project/session navigator (graph, layout switching, session detail, custom scan
roots) is implemented and tested. Planned next: a chronological timeline layout, and drilling into a
session to see its subagent runs and memory activity as graph nodes.

## License

[MIT](LICENSE)
