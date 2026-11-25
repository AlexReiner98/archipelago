/**
 * Runs an app server (app/server.ts) on its own, so it outlives the
 * terminal or session that started it. scripts/live.ts uses it for the live
 * server; `npm run dev:*` for the dev one.
 *
 *   node scripts/server.ts start  [options]   start it detached, if not running
 *   node scripts/server.ts stop   [options]   stop it
 *   node scripts/server.ts status [options]   say whether it runs, and where
 *
 * Options:
 *   --root dir    the checkout to run app/server.ts from (default this one)
 *   --data dir    its data (graph.sqlite, exchange.jsonl), default <root>/app/.data
 *   --port n      the page's port; the adapter is n + 1, the bridge n + 2 (default 5180)
 *   --no-watch    hot reload off
 *   --no-write    the written plugin off: no skill or memory file is written
 *
 * The data persists across restarts. The server's output goes to server.log
 * there, its pid to server.pid.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    root: { type: "string", default: here },
    data: { type: "string" },
    port: { type: "string", default: "5180" },
    watch: { type: "boolean", default: true },
    write: { type: "boolean", default: true },
  },
});
const root = resolve(values.root);
const data = resolve(values.data ?? join(root, "app", ".data"));
const pidFile = join(data, "server.pid");
const logFile = join(data, "server.log");
const PAGE = `http://127.0.0.1:${values.port}/app/`;

function pid(): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  const n = Number(readFileSync(pidFile, "utf8").trim());
  try {
    process.kill(n, 0);
    return n;
  } catch {
    rmSync(pidFile, { force: true });
    return undefined;
  }
}

async function up(): Promise<boolean> {
  try {
    await fetch(PAGE, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function down(): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (!(await up())) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

switch (positionals[0] ?? "status") {
  case "start": {
    const running = pid();
    if (running) {
      console.log(`already running (pid ${running}), ${PAGE}`);
      break;
    }
    if (await up()) {
      console.log(`something else already serves ${PAGE} (npm run serve in a terminal?): stop it first`);
      process.exitCode = 1;
      break;
    }
    mkdirSync(data, { recursive: true });
    const log = openSync(logFile, "a");
    // Port and watch go as environment, which an older app/server.ts ignores
    // rather than refusing an unknown flag.
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "app", "server.ts"), "--data", data], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, ARCHIPELAGO_PORT: values.port, ARCHIPELAGO_WATCH: values.watch ? "1" : "0", ARCHIPELAGO_WRITE: values.write ? "1" : "0" },
    });
    closeSync(log);
    writeFileSync(pidFile, String(child.pid));
    child.unref();
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
    if (await up()) console.log(`started (pid ${child.pid}), ${PAGE}${values.watch ? "" : " (hot reload off)"}\nroot ${root}\ndata ${data}\nlog ${logFile}`);
    else {
      console.log(`started (pid ${child.pid}) but ${PAGE} doesn't answer yet: see ${logFile}`);
      process.exitCode = 1;
    }
    break;
  }
  case "stop": {
    const running = pid();
    if (!running) {
      console.log("not running");
      break;
    }
    process.kill(running);
    rmSync(pidFile, { force: true });
    if (!(await down())) {
      console.log(`stopped (pid ${running}), but ${PAGE} still answers`);
      process.exitCode = 1;
      break;
    }
    console.log(`stopped (pid ${running})`);
    break;
  }
  case "status": {
    const running = pid();
    console.log(running ? `running (pid ${running}), ${PAGE}, root ${root}, data ${data}` : (await up()) ? `not started by this script, but ${PAGE} answers` : "not running");
    break;
  }
  default:
    console.log("node scripts/server.ts start|stop|status [--root dir] [--data dir] [--port n] [--no-watch] [--no-write]");
    process.exitCode = 1;
}
