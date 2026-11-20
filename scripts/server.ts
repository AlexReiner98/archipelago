/**
 * Runs the app server (app/server.ts) on its own, so it outlives the
 * terminal or session that started it.
 *
 *   node scripts/server.ts start [--data dir]   start it detached, if not running
 *   node scripts/server.ts stop                 stop it
 *   node scripts/server.ts status               say whether it runs, and where
 *
 * The data (graph.sqlite, exchange.jsonl) lives in --data, default app/.data,
 * so it persists across restarts. The server's output goes to server.log
 * there, its pid to server.pid.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { data: { type: "string", default: join(root, "app", ".data") } },
});
const data = resolve(values.data);
const pidFile = join(data, "server.pid");
const logFile = join(data, "server.log");
const PAGE = "http://127.0.0.1:5180/app/";

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
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "app", "server.ts"), "--data", data], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    writeFileSync(pidFile, String(child.pid));
    child.unref();
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
    if (await up()) console.log(`started (pid ${child.pid}), ${PAGE}\ndata ${data}\nlog ${logFile}`);
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
    console.log(`stopped (pid ${running})`);
    break;
  }
  case "status": {
    const running = pid();
    console.log(running ? `running (pid ${running}), ${PAGE}, data ${data}` : (await up()) ? `not started by this script, but ${PAGE} answers` : "not running");
    break;
  }
  default:
    console.log("node scripts/server.ts start|stop|status [--data dir]");
    process.exitCode = 1;
}
