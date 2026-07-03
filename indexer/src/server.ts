import fs from "node:fs";
import path from "node:path";
import { createApp } from "./api/app.js";
import { openIndexDb } from "./db/indexDb.js";
import { openAnnotationsDb } from "./db/annotationsDb.js";
import { API_HOST, API_PORT, ANNOTATIONS_DB_PATH, INDEX_DB_PATH, defaultProjectsRoot } from "./config.js";
import { consoleLogger } from "./logger.js";

fs.mkdirSync(path.dirname(INDEX_DB_PATH), { recursive: true });

const indexDb = openIndexDb(INDEX_DB_PATH);
const annotationsDb = openAnnotationsDb(ANNOTATIONS_DB_PATH);

const app = createApp({
  indexDb,
  annotationsDb,
  defaultProjectsRoot: defaultProjectsRoot(),
  logger: consoleLogger
});

app.listen(API_PORT, API_HOST, () => {
  consoleLogger.info(`Indexer API listening on http://${API_HOST}:${API_PORT}`);
});
