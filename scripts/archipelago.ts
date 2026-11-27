/**
 * Maps by name, from one command line (issue #24): a checkout's code serves
 * a map, on any free port, and nothing clashes. `npm run map -- <verb>`.
 *
 *   serve [--map name] [--from map|dir] [--port n] [--no-write] [--no-watch]
 *        this checkout's code serving the map, in this terminal
 *   up    [--map name] [same options]   the same, detached: it outlives the terminal or preview that started it
 *   down  <map>                         stops the map's server
 *   ls                                  every server: map, port, commit, checkout, the folders that report to it
 *   sync  <map|url> [--map name] [--dry] [--keep theirs] [--token t]
 *        syncs the map (default live) with another, both ways: what each
 *        changed since they last synced, the later change winning field by
 *        field (plugins/sync). The other is a map served here by name, or a
 *        server's bridge by url (its token in --token or ARCHIPELAGO_SYNC_TOKEN).
 *        The first run joins the two (the map's own fields kept where a pair
 *        differs; --keep theirs keeps the other's). --dry says what would
 *        go, and writes nothing.
 *   go    [--folder dir] [--no-connect] [--no-open]
 *        jump in: map live set up and running (live:setup, live:start, each
 *        only when needed), the folder you are in connected to it, its page
 *        open. Safe to run any time: run again, it only opens the page.
 *        `archipelago` with nothing after it (bin/archipelago.mjs) is `go`.
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
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { httpEnd, syncMaps, type Report } from "../plugins/sync/run.ts";
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
    open: { type: "boolean", default: true },
    connect: { type: "boolean", default: true },
    folder: { type: "string" },
    dry: { type: "boolean", default: false },
    token: { type: "string" },
    keep: { type: "string" },
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

/** Whether a folder is the given checkout or inside it (the live worktree is never connected: it serves the map). */
function insideOf(folder: string, checkout: string): boolean {
  const fold = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  const r = relative(fold(checkout), fold(folder));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

/** Connects a folder to map live through its bridge (`connect.here`), as the person at the machine; what to tell them. */
async function connectHere(bridge: number, folder: string): Promise<string> {
  const call = async (action: string) => {
    const r = await fetch(`http://127.0.0.1:${bridge}/call`, {
      method: "POST",
      body: JSON.stringify({ key: "action.invoke", method: "invoke", args: [{ action, input: { folder }, authority: { of: "human", basis: "ran archipelago in this folder" }, reason: "archipelago: connect the folder it was run in" }] }),
      signal: AbortSignal.timeout(10_000),
    });
    return ((await r.json()) as { value?: { ok: boolean; output?: { connected?: boolean; reports_to?: string }; refused?: { message: string } }; error?: string });
  };
  try {
    const state = (await call("connect.folder")).value;
    if (state?.ok && state.output?.connected) return `${folder} reports to map live.`;
    const r = await call("connect.here");
    if (r.value?.ok) return `connected ${folder}: start a new Claude Code session there (terminal or desktop app) and it reports to map live.`;
    return `not connected: ${r.value?.refused?.message ?? r.error ?? "no answer"}`;
  } catch (e) {
    return `not connected: map live's bridge didn't answer (${(e as Error).message})`;
  }
}

/** Opens a page in the default browser; quietly does nothing where it can't. */
function openPage(url: string): void {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
  } catch {}
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
  case "go": {
    // The folder the person is in: npm run keeps it in INIT_CWD, the bin runs there.
    const folder = resolve(values.folder ?? process.env.INIT_CWD ?? process.cwd());
    const node = (script: string, ...args: string[]) =>
      spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(here, "scripts", script), ...args], { cwd: here, stdio: "inherit" }).status === 0;
    if (!servedOf("live", home)) {
      // Each step only when it is needed: setup makes nothing twice, start moves an older live in.
      if (!node("live.ts", "setup") || !node("live.ts", "start")) process.exit(1);
    }
    const s = servedOf("live", home);
    if (!s?.port) {
      console.log("map live didn't come up: npm run live:status says why");
      process.exit(1);
    }
    const url = page(s.port);
    if (values.connect && !insideOf(folder, s.checkout)) {
      const said = await connectHere(s.port + 2, folder);
      console.log(said);
    }
    if (values.open) openPage(url);
    console.log(`map live: ${url}`);
    break;
  }
  case "sync": {
    const mine = values.map ?? "live";
    const other = positionals[1];
    if (!other) {
      console.log("npm run map -- sync <map|url> [--map name] [--dry] [--keep theirs] [--token t]");
      process.exit(1);
    }
    /** A map served here, by its bridge (two above its page). */
    const bridgeOf = (map: string): string => {
      const s = servedOf(map, home);
      if (!s?.port) {
        console.log(`map ${map} isn't running: npm run map -- up --map ${map}`);
        process.exit(1);
      }
      return `http://127.0.0.1:${s.port + 2}`;
    };
    const far = /^https?:\/\//.test(other) ? httpEnd(other, values.token ?? process.env.ARCHIPELAGO_SYNC_TOKEN) : httpEnd(bridgeOf(other));
    let r: Report;
    try {
      r = await syncMaps(httpEnd(bridgeOf(mine)), far, { dry: values.dry, keep: values.keep === "theirs" ? "b" : "a" });
    } catch (e) {
      console.log(`not synced: ${(e as Error).message}`);
      process.exitCode = 1;
      break;
    }
    const said = (v: { value?: unknown; gone?: true }) => (v.gone ? "taken away" : v.value === undefined ? "unset" : JSON.stringify(v.value).slice(0, 60));
    console.log(`${r.dry ? "would sync" : "synced"} ${r.a.name} and ${r.b.name}`);
    console.log(`  ${r.a.name}: ${r.a.read} change sets since the last sync, ${r.dry ? "" : `${r.a.sent} sent (${r.a.facts} facts)`}`);
    console.log(`  ${r.b.name}: ${r.b.read} change sets since the last sync, ${r.dry ? "" : `${r.b.sent} sent (${r.b.facts} facts)`}`);
    if (r.joined) {
      const j = r.joined;
      console.log(`  first sync, joined: ${j.same} items on both (${j.differed} differed, ${j.kept === "a" ? r.a.name : r.b.name}'s kept), ${j.copied.toB} copied to ${r.b.name}, ${j.copied.toA} to ${r.a.name}${j.ambiguous ? `, ${j.ambiguous} names on more than one item left unpaired` : ""}`);
    }
    if (r.plugins) console.log(`  made by a map's own plugins: ${r.plugins.paired} paired with the other's, ${r.plugins.copied} copied`);
    if (r.conflicts.length) {
      console.log(`  ${r.conflicts.length} changed on both, the later kept:`);
      for (const c of r.conflicts) {
        const won = c.won === "a" ? r.a.name : r.b.name;
        console.log(`    ${c.title ?? c.id}${c.field ? ` · ${c.field}` : ""}: ${won}'s (${r.a.name}: ${said(c.a)}, ${r.b.name}: ${said(c.b)})`);
      }
    }
    for (const f of r.refused) console.log(`  refused on ${f.to === "a" ? r.a.name : r.b.name}: set ${f.set}, ${f.code}: ${f.message}`);
    if (!r.dry) console.log("  each copy is a change set by agent:sync/<the other map>: history.undo takes it back");
    break;
  }
  default:
    console.log("npm run map -- serve|up [--map name] [--from map|dir] [--port n] [--no-write] [--no-watch] | down <map> | ls | sync <map|url> [--map name] [--dry] [--keep theirs] [--token t] | go [--folder dir] [--no-connect] [--no-open]");
    process.exitCode = 1;
}
