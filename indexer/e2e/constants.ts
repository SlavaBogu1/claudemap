// ORIGIN_TEST_PORT is the Visualizer's REAL dev port (5173) — one of the two literal entries in
// the production CORS allowlist (src/config.ts ALLOWED_ORIGINS). Using the real value here (rather
// than a stand-in) means this suite proves the actual shipped allowlist works, exactly as the
// CR-API-02 acceptance criteria specify. If a real `npm run dev` Visualizer is already up on 5173,
// Playwright's `reuseExistingServer` just reuses it — fine, since only the *origin* matters here,
// not the page content.
//
// API_TEST_PORT is deliberately NOT the real Indexer dev port (4317): the test API server below
// uses fixture data and a mocked openFolder (never shells out), so it must never be mistaken for
// — or collide with — a real `npm run dev` instance.
export const API_TEST_PORT = 4398;
export const ORIGIN_TEST_PORT = 5173;
export const ALLOWED_TEST_ORIGIN = `http://localhost:${ORIGIN_TEST_PORT}`;
export const API_TEST_BASE = `http://127.0.0.1:${API_TEST_PORT}`;
