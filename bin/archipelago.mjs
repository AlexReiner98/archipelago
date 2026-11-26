#!/usr/bin/env node
/**
 * `archipelago`: the map command from any folder (`npm link` in a clone puts
 * it on the PATH). Plain JavaScript, so it can say which Node it needs
 * before any TypeScript runs (node-min.mjs). With nothing after it, it is
 * `go` (scripts/archipelago.ts): map live set up and running, the folder
 * you are in connected to it, its page open.
 *
 *   archipelago                           jump in (go)
 *   archipelago ls|up|down|serve|go ...   as npm run map -- <verb>
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_MIN, newEnough } from "./node-min.mjs";

if (!newEnough(process.versions.node)) {
  console.log(`Archipelago needs Node ${NODE_MIN.join(".")} or later; this is ${process.versions.node}. Install a newer one from https://nodejs.org, then run archipelago again.`);
  process.exit(1);
}
const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "archipelago.ts");
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", script, ...(args.length ? args : ["go"])], { stdio: "inherit" });
process.exit(r.status ?? 1);
