/**
 * Maps by name, from one command line (issue #24): a checkout's code serves
 * a map, on any free port, and nothing clashes. `npm run map -- <verb>`.
 *
 *   serve [--map name] [--from map|dir] [--port n] [--no-write] [--no-watch]
 *        this checkout's code serving the map, in this terminal
 *   up    [--map name] [same options]   the same, detached: it outlives the terminal or preview that started it
 *   down  <map>                         stops the map's server
 *   ls                                  every server: map, port, commit, checkout, the folders that report to it
 *
 * With no --map, the map is named after the checkout's branch (`claude/x` is
 * `claude-x`), and when it has no data yet and a map `live` exists, it starts
 * as a copy of live. --from copies from another map by name, or a data
 * folder (an older live's: ../archipelago-live/app/.data). A map's data is
 * <home>/maps/<name> (ARCHIPELAGO_HOME, default ~/.archipelago), outside any
 * checkout; its server is in <home>/servers/<name>.json while it runs, and a
 * second server for it is refused (app/server.ts --map, scripts/maps.ts).
 *
 * `live:*` serve map `live` through this command (scripts/live.ts).
 * `npm run serve`, `dev` and `dev:*` stay on their fixed ports, and say in
 * one line when those are taken.
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultMap, hasMap, homeOf, MAP_NAME, mapDir, reporting, servedOf, serverFile, servers, alive } from "./maps.ts";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homeOf();
const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    map: { type: "string" },
    from: { type: "string" },
    port: { type: "string" },
    watch: { type: "boolean", default: true },
    write: { type: "boolean", default: true },
  },
});
const verb = positionals[0] ?? "ls";

/** The map a verb is for, and where it copies from on its first start. */
function target(): { map: string; from?: string } {
  const map = values.map ?? positionals[1] ?? defaultMap(here);
  if (!MAP_NAME.test(map)) {
    console.log(`refused: "${map}" is not a map name (letters, digits, ".", "_" and "-")`);
    process.exit(1);
  }
  const from = values.from ?? (!hasMap(mapDir(map, home)) && map !== "live" && hasMap(mapDir("live", home)) ? "live" : undefined);
  return { map, ...(from ? { from } : {}) };
}

/** app/server.ts's arguments for a map. */
function serverArgs(map: string, from?: string): string[] {
  return [
    "--disable-warning=ExperimentalWarning",
    join(here, "app", "server.ts"),
    "--map",
    map,
    ...(from ? ["--from", from] : []),
    ...(values.port ? ["--port", values.port] : []),
    ...(values.watch ? [] : ["--no-watch"]),
    ...(values.write ? [] : ["--no-write"]),
  ];
}

const page = (port: number) => `http://127.0.0.1:${port}/app/`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Refused when another process already serves the map. */
function notServed(map: string): void {
  const s = servedOf(map, home);
  if (s) {
    console.log(`map ${map} is already served by pid ${s.pid} on ${page(s.port!)}, from ${s.checkout}${s.commit ? ` at ${s.commit}` : ""}`);
    process.exit(verb === "up" && s.checkout === here ? 0 : 1);
  }
}

switch (verb) {
  case "serve": {
    const { map, from } = target();
    notServed(map);
    if (from) console.log(`map ${map}: starting as a copy of ${from}`);
    const child = spawn(process.execPath, serverArgs(map, from), { cwd: here, stdio: "inherit" });
    const pass = (sig: NodeJS.Signals) => child.kill(sig);
    process.on("SIGINT", pass);
    process.on("SIGTERM", pass);
    child.on("exit", (code) => process.exit(code ?? 0));
    break;
  }
  case "up": {
    const { map, from } = target();
    notServed(map);
    const data = mapDir(map, home);
    mkdirSync(data, { recursive: true });
    const logFile = join(data, "server.log");
    const log = openSync(logFile, "a");
    const child = spawn(process.execPath, serverArgs(map, from), { cwd: here, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
    closeSync(log);
    child.unref();
    for (let i = 0; i < 120; i++) {
      const s = servedOf(map, home);
      if (s && s.pid === child.pid) {
        try {
          await fetch(page(s.port!), { signal: AbortSignal.timeout(1000) });
          console.log(`map ${map} up (pid ${s.pid}), ${page(s.port!)}\ncode ${here}${s.commit ? ` at ${s.commit}` : ""}\ndata ${data}\nlog ${logFile}`);
          process.exit(0);
        } catch {}
      }
      if (child.exitCode !== null || (child.pid && !alive(child.pid))) break;
      await wait(250);
    }
    console.log(`map ${map} didn't come up: see ${logFile}`);
    process.exit(1);
    break;
  }
  case "down": {
    const map = positionals[1] ?? values.map;
    if (!map || !MAP_NAME.test(map)) {
      console.log("npm run map -- down <map>");
      process.exit(1);
    }
    const s = servers(home).find((e) => e.map === map);
    if (!s?.running) {
      if (s) rmSync(serverFile(map, home), { force: true });
      console.log(`map ${map} isn't running`);
      break;
    }
    process.kill(s.pid);
    const pid = s.pid;
    for (let i = 0; i < 40 && alive(pid); i++) await wait(250);
    // A hard stop (Windows) runs no exit handler: the entry goes here.
    if (!alive(pid)) rmSync(serverFile(map, home), { force: true });
    console.log(alive(pid) ? `map ${map}: pid ${pid} still runs` : `map ${map} down (pid ${pid})`);
    if (alive(pid)) process.exitCode = 1;
    break;
  }
  case "ls": {
    const all = servers(home).sort((a, b) => a.map.localeCompare(b.map));
    if (!all.length) {
      console.log(`no server runs a map (${join(home, "servers")})`);
      break;
    }
    for (const s of all) {
      const where = s.running ? (s.port ? page(s.port) : "starting") : "stopped (stale entry)";
      const folders = reporting(s.data);
      console.log(`${s.map}\t${where}\t${s.commit ?? ""}\t${s.checkout}${folders.length ? `\n\treported to by ${folders.join(", ")}` : ""}`);
    }
    break;
  }
  default:
    console.log("npm run map -- serve|up [--map name] [--from map|dir] [--port n] [--no-write] [--no-watch] | down <map> | ls");
    process.exitCode = 1;
}
