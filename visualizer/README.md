# Claude Session Explorer — Visualizer

Browser UI that renders a Claude Code project's sessions as a node-link graph (project → sessions),
consuming the Indexer's local, read-only HTTP API (`_API_CONTRACT/CONTRACT.md`).

**Stack:** TypeScript · Vite · React · Cytoscape.js (via `react-cytoscapejs`) · vitest (unit) ·
Playwright (e2e, mocked API).

## Commands

```bash
npm install
npm run dev         # local dev server
npm test            # vitest unit suite
npm run test:e2e    # Playwright e2e suite (mocked API; builds + previews first)
npm run build        # type-check + production build
npm run preview      # preview the production build
```

## Structure

```
src/
  api/client.ts          # fetch wrapper for the Indexer's HTTP API
  lib/preferences.ts      # localStorage-backed user preferences (default layout)
  components/             # ProjectPicker, GraphCanvas, LayoutSwitcher, DetailPanel, BurgerMenu, ...
  types.ts                # types mirroring the API contract
e2e/                       # Playwright specs + fixtures (route-interception API mocks)
```

The app never talks to a live Indexer during tests — all Indexer calls are intercepted/mocked.
