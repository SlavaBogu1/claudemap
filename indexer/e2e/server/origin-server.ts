// Minimal static page server standing in for the Visualizer's real dev origin
// (http://localhost:5173) for the CR-API-02 real-browser CORS e2e check. The page itself does
// nothing — the test drives cross-origin `fetch()` calls against the real Indexer API from this
// origin via `page.evaluate`, so only the *origin* (scheme+host+port) matters.
import http from "node:http";
import { ORIGIN_TEST_PORT } from "../constants.js";

const html = "<!doctype html><html><body><h1>CR-API-02 test origin</h1></body></html>";

http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  })
  .listen(ORIGIN_TEST_PORT, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`[e2e] test origin page listening on http://127.0.0.1:${ORIGIN_TEST_PORT}`);
  });
