# Setup & Deployment Guide

This document covers installation, restoration after transfer, and deployment for Claude Session Explorer.

## Quick Start

### First Time Setup

```bash
npm ci
npm run start
```

Open **http://localhost:5173** in your browser.

### After Transferring to a New System

```bash
npm ci
```

Your project is instantly ready. See [Why This Works](#why-portability-works) below.

---

## Installation Methods

### `npm ci` (Recommended for Transfers & Deployment)

```bash
npm ci
```

**Use this when:**
- Transferring the project to a new system
- Pulling changes that included `package-lock.json` updates
- Setting up in CI/CD or production
- You want guaranteed reproducibility

**Why:** Uses exact versions from lock files — no version resolution needed, faster, and identical results on every system.

**What it does:**
- Installs exact versions for all 3 packages (root + indexer + visualizer)
- Fails immediately if lock files are out of sync with `package.json` (safety check)
- Respects npm workspaces configuration

### `npm install` (Manual Setup Only)

```bash
npm install
```

**Use this when:**
- Setting up from scratch and you're intentionally picking latest compatible versions
- Updating dependencies for all packages at once

**Note:** This may pick different minor/patch versions across systems if run at different times.

---

## Common Workflows

### One-Command Full Start (Production-Style)

```bash
npm ci && npm run start
```

Builds and launches both services with labeled output. Open **http://localhost:5173**.

### Development with Hot Reload (Two Terminals)

**Terminal 1 — Indexer:**
```bash
cd indexer
npm run dev
# → http://127.0.0.1:4317
```

**Terminal 2 — Visualizer:**
```bash
cd visualizer
npm run dev
# → http://localhost:5173
```

*Note: Run `npm ci` once from the root before doing this.*

### Development from Root (Using Workspace Flags)

```bash
# Terminal 1
npm run dev -w indexer

# Terminal 2
npm run dev -w visualizer
```

### Testing

```bash
# All packages
npm test

# Specific package
npm test -w indexer
npm test -w visualizer

# End-to-end tests
npm run test:e2e -w indexer
npm run test:e2e -w visualizer
```

### Building for Production

```bash
# All packages
npm run build

# Or specific packages
npm run build -w indexer
npm run build -w visualizer
```

---

## Transferring Between Systems

### Pre-Transfer Checklist

✅ All changes committed or stashed  
✅ Local databases cleaned (optional: delete `indexer/data/` if you don't need the cache)  
✅ `.gitignore` prevents `node_modules/` from being included  

### Transfer Steps

1. **Copy the repository** (e.g., `git clone`, rsync, ZIP file, USB drive)
   - Git automatically excludes `node_modules/` and build artifacts per `.gitignore`
   - If copying manually, ensure you skip `node_modules/`, `dist/`, `build/`, and `indexer/data/`

2. **On the new system, restore dependencies:**
   ```bash
   npm ci
   ```

3. **Verify (optional):**
   ```bash
   npm run -v              # Lists workspace packages
   npm test -w indexer     # Quick sanity check
   ```

4. **Start developing or running:**
   ```bash
   npm run start           # Production mode
   # OR
   npm run dev -w indexer && npm run dev -w visualizer  # Development mode
   ```

### Why Portability Works

| Artifact | Included in Git | Purpose |
|----------|-----------------|---------|
| `package.json` (root) | ✅ Yes | Defines workspaces + root dependencies |
| `package-lock.json` (root) | ✅ Yes | Locks exact versions for root + all workspaces |
| `indexer/package.json` | ✅ Yes | Indexer dependencies |
| `indexer/package-lock.json` | ✅ Yes | Locks exact versions for Indexer |
| `visualizer/package.json` | ✅ Yes | Visualizer dependencies |
| `visualizer/package-lock.json` | ✅ Yes | Locks exact versions for Visualizer |
| `node_modules/` | ❌ .gitignore | Rebuilt by `npm ci` on each system |
| `dist/`, `build/` | ❌ .gitignore | Rebuilt by `npm run build` |
| `.gitignore` | ✅ Yes | Ensures `node_modules/` never gets transferred |

**Result:** Transfer the repo → run `npm ci` → identical environment on every system.

---

## Troubleshooting

### "node_modules not found" or "missing dependencies"

```bash
npm ci
```

If that fails, check:
1. Node.js version: `node --version` (should be v18+)
2. npm version: `npm --version` (should be v9+)
3. Lock files exist: `ls package-lock.json indexer/package-lock.json visualizer/package-lock.json`

### Port 5173 Already in Use

```bash
# Change the preview port in the start script
# Edit package.json "start:visualizer" line, or run:
npm run preview -w visualizer -- --port 3000

# Then update CORS in indexer/src/config.ts:
# ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
```

### Lock File Conflicts After Merging Branches

```bash
# Discard your local lock file changes
git checkout -- package-lock.json indexer/package-lock.json visualizer/package-lock.json

# Re-resolve with the merged version
npm ci
```

### Slow Install

- First install may take 1-3 minutes (initial module fetch)
- `npm ci` is faster than `npm install` (lock files pre-computed)
- Use `npm ci --prefer-offline` to cache dependencies locally

---

## Architecture: npm Workspaces

This project uses npm workspaces — a monorepo structure where one root `package.json` manages multiple sub-packages:

```
claude-session-explorer/
├── package.json              (root workspace config)
├── package-lock.json         (locks all versions)
├── indexer/
│   ├── package.json          (Indexer dependencies)
│   ├── package-lock.json     (Indexer lock)
│   └── src/
├── visualizer/
│   ├── package.json          (Visualizer dependencies)
│   ├── package-lock.json     (Visualizer lock)
│   └── src/
└── node_modules/             (shared, generated by npm ci)
```

**Benefits:**
- Single `npm ci` installs all packages and their dependencies
- Shared dependencies deduplicated in root `node_modules/`
- Each package can have its own scripts and versions
- `npm run <script> -w <package>` runs scripts in specific packages
- Single lock file per package ensures reproducibility

---

## CI/CD Integration

For GitHub Actions or other CI systems:

```yaml
- name: Install dependencies
  run: npm ci

- name: Test
  run: npm test

- name: Build
  run: npm run build
```

The lock files ensure the same versions are used on CI as locally.

---

## Support

For issues with:
- **Node.js/npm installation:** see https://nodejs.org/
- **Project-specific setup:** check `indexer/CLAUDE.md` and `visualizer/CLAUDE.md`
- **API contract:** see `_API_CONTRACT/CONTRACT.md`
- **Shared constants (ports, paths):** see `REQUIREMENTS/SHARED_CONSTANTS.md`
