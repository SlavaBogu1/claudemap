# Deployment Cheatsheet

Print this or bookmark it for fast reference.

## Transfer to New System (30 seconds)

```bash
# On the new system:
npm ci
```

Done. That's it.

## One-Command Start

```bash
npm ci && npm run start
```

Then open **http://localhost:5173**

## Development (Two Terminals)

### Terminal 1
```bash
npm run dev -w indexer
```
Runs on `http://127.0.0.1:4317`

### Terminal 2
```bash
npm run dev -w visualizer
```
Runs on `http://localhost:5173`

## Testing

```bash
npm test                    # All tests
npm test -w indexer         # Indexer only
npm test -w visualizer      # Visualizer only
npm run test:e2e -w indexer # Browser tests (Indexer)
npm run test:e2e -w visualizer # Browser tests (Visualizer)
```

## Building

```bash
npm run build               # Both packages
npm run build -w indexer    # Indexer only
npm run build -w visualizer # Visualizer only
```

## Inside a Package

```bash
cd indexer
npm run dev                 # Dev with hot reload
npm test                    # Run tests
npm run build               # Build only

cd visualizer
npm run dev                 # Vite dev server
npm test                    # Run tests
npm run build               # Vite build
```

## Network Ports

| Service | URL | Port |
|---------|-----|------|
| Visualizer | http://localhost:5173 | 5173 |
| Indexer API | http://127.0.0.1:4317 | 4317 |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `node_modules` missing | `npm ci` |
| Port already in use | Kill the process or change port in `package.json` |
| Tests failing after transfer | `npm ci` then `npm test` |
| Stale dependencies | `npm ci --prefer-offline` |

## Files You Need to Transfer

✅ **Always include:**
- `package.json` (root, indexer, visualizer)
- `package-lock.json` (root, indexer, visualizer)
- `.gitignore`
- All source code (`src/` directories)

❌ **Never transfer (auto-rebuilt by `npm ci`):**
- `node_modules/`
- `dist/`
- `build/`

❌ **Optional (can be deleted before transfer):**
- `indexer/data/` (SQLite cache — will be rebuilt on first run)

## Full Setup from Scratch

1. Clone or copy repo
2. `npm ci` — install all packages
3. `npm run start` — launch both services
4. Open http://localhost:5173

---

For full details, see [SETUP.md](SETUP.md)
