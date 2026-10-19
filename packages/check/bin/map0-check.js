#!/usr/bin/env node
import { main } from "../dist/map0-check.js";

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 2;
}
