/**
 * Connects this checkout's own Claude Code sessions to the map, or takes
 * that out again (plugins/connect/here.ts). For a client that can't be
 * started with `--settings` (the desktop app); a terminal needs none of it.
 *
 *   node scripts/connect.ts here [--port 5280]   then start a new session in this folder
 *   node scripts/connect.ts away                 everything it wrote, gone
 *
 * `--port` is the page's port, as `npm run dev` or `serve` was given it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectHere, disconnectHere, forPort, type HereFiles } from "../plugins/connect/here.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: "string", default: "5280" } } });
const what = positionals[0];
if (what !== "here" && what !== "away") {
  console.error("node scripts/connect.ts here [--port 5280] | away");
  process.exit(1);
}

const at = {
  settings: join(root, ".claude", "settings.local.json"),
  mcp: join(root, ".mcp.json"),
  // git reads info/exclude from the common folder, which a worktree shares with its main checkout.
  exclude: resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim(), "info", "exclude"),
};
const json = (path: string) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined);
const files: HereFiles = {
  settings: json(at.settings),
  mcp: json(at.mcp),
  exclude: existsSync(at.exclude) ? readFileSync(at.exclude, "utf8") : undefined,
};

const write = (path: string, value: object | undefined) => {
  if (value === undefined) return void rmSync(path, { force: true });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

if (what === "here") {
  const port = Number(values.port);
  const repo = {
    settings: forPort(json(join(root, "plugins", "claude-code", "settings.json")), port),
    mcp: forPort(json(join(root, "plugins", "claude-code", "mcp.json")), port),
  };
  const out = connectHere(files, repo);
  write(at.settings, out.settings);
  write(at.mcp, out.mcp);
  mkdirSync(dirname(at.exclude), { recursive: true });
  writeFileSync(at.exclude, out.exclude!);
  console.log(`Connected: a new Claude Code session in this folder reports to the map on 127.0.0.1:${port + 1}. npm run disconnect:here takes it out.`);
} else {
  const out = disconnectHere(files);
  write(at.settings, out.settings);
  write(at.mcp, out.mcp);
  if (out.exclude !== undefined) writeFileSync(at.exclude, out.exclude);
  // A .claude folder left empty goes too (one with anything else in it stays).
  try {
    rmdirSync(dirname(at.settings));
  } catch {}
  console.log("Disconnected: this folder's sessions no longer report to the map.");
}
