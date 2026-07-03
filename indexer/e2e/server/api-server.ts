// Real Indexer API server for the CR-API-02 real-browser CORS e2e check. Uses fixture data (not
// real ~/.claude) and a no-op openFolder (never shells out to explorer.exe during automated
// tests) — everything else (Express app, CORS middleware, routes) is the real production code.
import { createApp } from "../../src/api/app.js";
import { openIndexDb } from "../../src/db/indexDb.js";
import { openAnnotationsDb } from "../../src/db/annotationsDb.js";
import { buildFixture } from "../../tests/helpers/fixture.js";
import { API_TEST_PORT } from "../constants.js";

const fixture = buildFixture();
const indexDb = openIndexDb(":memory:");
const annotationsDb = openAnnotationsDb(":memory:");

const app = createApp({
  indexDb,
  annotationsDb,
  defaultProjectsRoot: fixture.projectsRoot,
  openFolder: () => {
    // Intentionally a no-op: an automated e2e run must never launch a real OS file explorer.
  },
  logger: { info: () => {}, warn: () => {} }
});

app.listen(API_TEST_PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e] test Indexer API listening on http://127.0.0.1:${API_TEST_PORT}`);
});
