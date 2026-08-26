#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateConfigState } from "./config-state-separation.mjs";

async function main() {
  const result = await migrateConfigState();
  console.log(
    `entrypoint: config state migration ${result.status} (version ${result.marker.version})`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`entrypoint: config state migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
