import { test, expect } from "@playwright/test";
import { API_TEST_BASE, ALLOWED_TEST_ORIGIN } from "./constants";

// CR-API-02 acceptance criteria 1 & 2 — verified with a REAL cross-origin browser request: a real
// Chromium page served from the allowed Visualizer origin, fetching a real Indexer API server.
// Nothing here is mocked or intercepted (no `page.route`) — a failure here means real users would
// see "Failed to fetch" exactly as the Tester found in TI-1.3.
//
// Note on preflight verification: Chromium/CDP does not surface CORS preflight OPTIONS requests
// through Playwright's page.on('request'/'response') — this is a known Playwright/CDP limitation
// (the network service handles/answers preflights before they reach the renderer's inspectable
// request pipeline), so a POST fetch's *success* is the real-browser proof that preflight passed
// (a failed preflight makes the browser reject the actual request with a thrown TypeError, never
// reaching our .json() call below). We additionally assert the exact preflight response headers
// via Playwright's `request` fixture — still a real, unmocked HTTP round-trip to the same running
// server, just issued directly rather than by the page's own (CDP-invisible) preflight machinery.

test.describe("CR-API-02 — real cross-origin CORS behavior", () => {
  test("GET /api/projects succeeds cross-origin from the allowed Visualizer origin", async ({ page }) => {
    await page.goto(ALLOWED_TEST_ORIGIN);
    expect(new URL(page.url()).origin).toBe(ALLOWED_TEST_ORIGIN);

    const result = await page.evaluate(async (apiBase) => {
      try {
        const res = await fetch(`${apiBase}/api/projects`);
        return { threw: false, status: res.status, body: await res.json() };
      } catch (err) {
        return { threw: true, message: String(err) };
      }
    }, API_TEST_BASE);

    expect(result.threw, "fetch() must not throw (no TypeError: Failed to fetch)").toBe(false);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body.length).toBeGreaterThan(0);
  });

  test("POST /api/projects/:id/open-folder and POST /api/projects/browse succeed cross-origin in a real browser (preflight passed)", async ({
    page
  }) => {
    await page.goto(ALLOWED_TEST_ORIGIN);

    // Discover a real fixture project id via the already-verified GET endpoint.
    const projectId: string = await page.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/api/projects`);
      const body = await res.json();
      return body[0].id;
    }, API_TEST_BASE);

    // --- POST /:id/open-folder --------------------------------------------------------------
    // Content-Type: application/json makes this a non-"simple" request, so the browser must run
    // a CORS preflight before sending it. If preflight failed, this fetch would throw, not
    // resolve — so a clean 200 here is real-browser proof the preflight succeeded.
    const openFolderResult = await page.evaluate(
      async ({ apiBase, projectId }) => {
        try {
          const res = await fetch(`${apiBase}/api/projects/${projectId}/open-folder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
          return { threw: false, status: res.status, body: await res.json() };
        } catch (err) {
          return { threw: true, message: String(err) };
        }
      },
      { apiBase: API_TEST_BASE, projectId }
    );
    expect(openFolderResult.threw, "open-folder fetch() must not throw").toBe(false);
    expect(openFolderResult.status).toBe(200);
    expect(openFolderResult.body).toEqual({ ok: true });

    // --- POST /browse ------------------------------------------------------------------------
    // An intentionally invalid path: the point is that CORS lets the request through to the real
    // route handler (which then does its own 400 business-logic validation) — not a network-level
    // CORS failure, which would surface as a thrown TypeError instead of a JSON 400 body.
    const browseResult = await page.evaluate(async (apiBase) => {
      try {
        const res = await fetch(`${apiBase}/api/projects/browse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Z:\\definitely\\not\\a\\real\\path" })
        });
        return { threw: false, status: res.status, body: await res.json() };
      } catch (err) {
        return { threw: true, message: String(err) };
      }
    }, API_TEST_BASE);
    expect(browseResult.threw, "browse fetch() must not throw").toBe(false);
    expect(browseResult.status).toBe(400);
    expect(browseResult.body).toHaveProperty("error");
  });

  test("preflight OPTIONS for both POST endpoints returns the correct Access-Control-Allow-* headers for the allowed origin", async ({
    request
  }) => {
    for (const url of [
      `${API_TEST_BASE}/api/projects/some-id/open-folder`,
      `${API_TEST_BASE}/api/projects/browse`
    ]) {
      const res = await request.fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: ALLOWED_TEST_ORIGIN,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type"
        }
      });
      expect(res.headers()["access-control-allow-origin"], `for ${url}`).toBe(ALLOWED_TEST_ORIGIN);
      expect(res.headers()["access-control-allow-methods"], `for ${url}`).toContain("POST");
    }
  });

  test("a disallowed arbitrary origin gets no Access-Control-Allow-Origin header (allowlist is not wide open)", async ({
    request
  }) => {
    const res = await request.fetch(`${API_TEST_BASE}/api/projects`, {
      headers: { Origin: "http://evil.example.com" }
    });
    // The server still answers (enforcement is the browser's job) — but without this header a
    // real browser refuses to hand the response body to the page's JavaScript.
    expect(res.status()).toBe(200);
    expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  });
});
