import { assertPreviewBuildDatabases } from "./preview-db-guard.js";
try {
  assertPreviewBuildDatabases(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "PREVIEW_DB_GUARD: error"}\n`);
  process.exit(1);
}
