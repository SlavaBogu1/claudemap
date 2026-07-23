# Setup & Deployment Documentation Summary

This document indexes all setup and deployment resources for Claude Session Explorer.

## 📚 Documentation Files

### [README.md](README.md)
**What it covers:** Project overview, quick start, CORS setup
**Read this for:**
- Understanding what Claude Session Explorer does
- First-time setup (30 seconds)
- Transferring to a new system
- Port configuration

### [SETUP.md](SETUP.md) ⭐ **MAIN REFERENCE**
**What it covers:** Complete setup guide, installation methods, all workflows, troubleshooting
**Read this for:**
- Choosing between `npm ci` vs `npm install`
- Development workflows (one vs two terminals)
- Testing and building commands
- Understanding why the project is portable
- Detailed troubleshooting
- CI/CD integration

### [DEPLOY_CHEATSHEET.md](DEPLOY_CHEATSHEET.md)
**What it covers:** Quick-reference commands for common tasks
**Read this for:**
- Fast lookup of commands
- Printing or bookmarking
- At-a-glance troubleshooting
- Port information

### [.npmrc](.npmrc)
**What it covers:** npm configuration for consistency and security
**Purpose:**
- Ensures identical npm behavior across all systems
- Enables offline caching for faster subsequent installs
- Verifies package integrity
- Enforces strict SSL by default

### [indexer/CLAUDE.md](indexer/CLAUDE.md)
**Indexer team guide** — updated with setup references and workspace commands

### [visualizer/CLAUDE.md](visualizer/CLAUDE.md)
**Visualizer team guide** — updated with setup references and workspace commands

---

## 🚀 Quick Start Paths

### "I just cloned this repo"
```bash
npm ci
npm run start
# Open http://localhost:5173
```

### "I'm transferring from another system"
```bash
npm ci
# Project is ready!
```

### "I want to develop with hot reload"
```bash
npm ci  # Once
# Terminal 1:
npm run dev -w indexer
# Terminal 2:
npm run dev -w visualizer
```

### "I need to run tests"
```bash
npm test              # All packages
npm test -w indexer   # Indexer only
npm test -w visualizer # Visualizer only
```

---

## 📋 Key Concepts

### Why `npm ci` for Transfers?

| Aspect | `npm ci` | `npm install` |
|--------|----------|---------------|
| **Uses lock files?** | ✅ Always | ❌ Only if needed |
| **Speed** | Fast | Slower |
| **Reproducibility** | Identical across systems | May vary |
| **Best for** | Transfers, CI/CD, production | Initial setup, updating deps |

**Answer:** Use `npm ci` to guarantee the same versions on every system.

### npm Workspaces

This project uses npm workspaces — a monorepo pattern where:
- **Root** (`package.json`) manages the workspace structure
- **Indexer** (`indexer/`) and **Visualizer** (`visualizer/`) are separate packages
- `npm ci` installs all three and their dependencies in one command
- You can run scripts in specific packages with `-w` flag:
  ```bash
  npm run dev -w indexer         # Run only Indexer dev server
  npm test -w visualizer         # Test only Visualizer
  npm run build                  # Build all packages
  ```

### Portability Checklist

✅ **In git** (transferred automatically):
- `package.json` (root, indexer, visualizer)
- `package-lock.json` (root, indexer, visualizer)
- `.gitignore`
- `.npmrc`
- All source code

❌ **Not in git** (rebuilt by `npm ci`):
- `node_modules/`
- `dist/` (build output)
- `indexer/data/` (SQLite cache)

**Result:** Clone/copy → `npm ci` → ready to develop

---

## 🔧 Commands at a Glance

```bash
# Installation & Setup
npm ci                           # Install (recommended)
npm install                      # Install (alternative, slower)

# Running Services
npm run start                    # Production mode (both services)
npm run dev -w indexer           # Indexer dev server
npm run dev -w visualizer        # Visualizer dev server

# Testing
npm test                         # All tests
npm test -w indexer              # Indexer unit tests
npm run test:e2e -w indexer      # Indexer browser tests
npm test -w visualizer           # Visualizer unit tests
npm run test:e2e -w visualizer   # Visualizer browser tests

# Building
npm run build                    # Build all packages
npm run build -w indexer         # Build Indexer only
npm run build -w visualizer      # Build Visualizer only

# Per-package (cd into package directory)
cd indexer && npm run dev        # Indexer dev (alternative)
cd visualizer && npm run build   # Visualizer build (alternative)
```

---

## 📞 Troubleshooting

**Problem:** `node_modules` missing after transfer  
**Solution:** `npm ci`

**Problem:** Port 5173 in use  
**Solution:** See [SETUP.md § Port Configuration](SETUP.md#port-5173-already-in-use)

**Problem:** Tests failing after transfer  
**Solution:** `npm ci` then `npm test`

**Problem:** Lock file merge conflicts  
**Solution:** `git checkout -- package-lock.json indexer/package-lock.json visualizer/package-lock.json && npm ci`

For more issues, see [SETUP.md § Troubleshooting](SETUP.md#troubleshooting).

---

## 🎯 For Different Roles

### Developer (New to Project)
1. Read [README.md](README.md) — understand what the project does
2. Follow [README.md § Setup & Installation](README.md#setup--installation)
3. Reference [DEPLOY_CHEATSHEET.md](DEPLOY_CHEATSHEET.md) for commands

### Transferring Between Systems
1. Copy/clone the repo (or `git clone`)
2. Run `npm ci`
3. Done!

### Setting Up CI/CD
1. Add this to your CI/CD pipeline:
   ```yaml
   - run: npm ci
   - run: npm test
   - run: npm run build
   ```
2. See [SETUP.md § CI/CD Integration](SETUP.md#cicd-integration)

### Team Lead / DevOps
- Review [SETUP.md](SETUP.md) for full architectural details
- Update `.npmrc` if you need custom registry or caching
- Refer team members to appropriate docs above

---

## 🌐 Network Configuration

| Service | Address | Port | Purpose |
|---------|---------|------|---------|
| Visualizer | http://localhost:5173 | 5173 | React app + Vite dev server |
| Indexer API | http://127.0.0.1:4317 | 4317 | Express API (localhost only) |
| CORS Allowlist | — | — | `localhost:5173`, `127.0.0.1:5173` |

---

## 📖 Additional Resources

- **Project overview:** [README.md](README.md)
- **Shared constants & architecture:** `REQUIREMENTS/SHARED_CONSTANTS.md`
- **API contract:** `_API_CONTRACT/CONTRACT.md`
- **Team-specific guides:** `indexer/CLAUDE.md`, `visualizer/CLAUDE.md`

---

## ✅ You're Ready!

Everything is documented. Pick your starting point above and follow the link. 🚀
