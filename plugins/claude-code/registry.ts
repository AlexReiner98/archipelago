/**
 * Where a map's server is: the registry of servers on this machine, read by
 * the hook script (hook.ts `--map`) and the MCP proxy (proxy.ts) on every
 * call, so a session connected to a map by name follows it to whatever port
 * it runs on, and does nothing while it isn't running.
 *
 * - The home: `ARCHIPELAGO_HOME`, else `~/.archipelago`.
 * - A map's data: `<home>/maps/<name>/`, never inside a checkout.
 * - Its server: `<home>/servers/<name>.json` (`Served`), written by
 *   app/server.ts while it runs (scripts/maps.ts writes it).
 * - A map served elsewhere: `<home>/remotes/<name>.json` (`Remote`).
 * - The switch: `<home>/current`, the one map a session given `current`
 *   reaches (`reachOf`), set with `npm run map -- use <name>`.
 *
 * Plain Node, no imports from the repository: hook.ts loads it only when a
 * hook names a map.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One server, as the registry keeps it. */
export interface Served {
  map: string;
  pid: number;
  /** The page's port: the adapter is one above, the bridge two. Absent while it starts. */
  port?: number;
  /** The commit it runs, short, with `+` when the checkout has changes. */
  commit?: string;
  /** The checkout it runs from. */
  checkout: string;
  /** The map's data folder. */
  data: string;
  started: string;
  /** The plugin folders it loaded, where the list came from, and each named one it couldn't load (app/server.ts, runtime/folders.ts). */
  plugins?: PluginFolders;
}

/** A server's plugin folders, as it says them: in its registry entry and `serving.about`. */
export interface PluginFolders {
  /** `flag` (--plugins), `env` (ARCHIPELAGO_PLUGINS) or `map` (the map's plugins.json); absent when it loads none. */
  from?: "flag" | "env" | "map";
  loaded: { name: string; dir: string }[];
  missing: { dir: string; why: string }[];
}

/** A map's name: letters, digits, `.`, `_` and `-`, so it is a file name everywhere. */
export const MAP_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export const homeOf = (env: Record<string, string | undefined> = process.env) => env.ARCHIPELAGO_HOME || join(homedir(), ".archipelago");
export const mapDir = (name: string, home = homeOf()) => join(home, "maps", name);
export const serverFile = (name: string, home = homeOf()) => join(home, "servers", `${name}.json`);

/** Whether a process is there. */
export function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The registry's entry for a map, whether or not its process is there. */
export function entryOf(name: string, home = homeOf()): Served | undefined {
  if (!MAP_NAME.test(name)) return undefined;
  try {
    const e = JSON.parse(readFileSync(serverFile(name, home), "utf8")) as Served;
    return typeof e.pid === "number" ? e : undefined;
  } catch {
    return undefined;
  }
}

/** A map's server while it runs and has its port; else nothing. */
export function servedOf(name: string, home = homeOf()): Served | undefined {
  const e = entryOf(name, home);
  return e && e.port && alive(e.pid) ? e : undefined;
}

/** The map's adapter (`http://127.0.0.1:<port + 1>`), or nothing while it isn't running. */
export function adapterOf(name: string, home = homeOf()): string | undefined {
  const e = servedOf(name, home);
  return e ? `http://127.0.0.1:${e.port! + 1}` : undefined;
}

/**
 * The name that follows the switch: a hook (`--map current`) or proxy
 * (`proxy.ts current`) given it reaches whichever map `<home>/current`
 * names, read again at every call. Never a map's own name.
 */
export const CURRENT = "current";
export const currentFile = (home = homeOf()) => join(home, "current");
export const remoteFile = (name: string, home = homeOf()) => join(home, "remotes", `${name}.json`);

/** The map the switch names (`<home>/current`), or nothing when none is. */
export function currentOf(home = homeOf()): string | undefined {
  try {
    const name = readFileSync(currentFile(home), "utf8").trim();
    return MAP_NAME.test(name) && name !== CURRENT ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A map served elsewhere, reached by its address (`<home>/remotes/<name>.json`):
 * its `/mcp` and `/hook` under `url`. The token is never in the file: it is
 * read from the variable `token_env` names, at each call.
 */
export interface Remote {
  map: string;
  url: string;
  token_env?: string;
}

/** A remote map's entry, or nothing. */
export function remoteOf(name: string, home = homeOf()): Remote | undefined {
  if (!MAP_NAME.test(name)) return undefined;
  try {
    const r = JSON.parse(readFileSync(remoteFile(name, home), "utf8")) as Remote;
    return typeof r.url === "string" && /^https?:\/\//.test(r.url) ? { ...r, map: name } : undefined;
  } catch {
    return undefined;
  }
}

/** Where a map is reached now: its MCP and hook endpoints, and the token a remote one takes. */
export interface Reach {
  /** The map's own name (the switch's, for `current`). */
  map: string;
  mcp: string;
  hook: string;
  token?: string;
  remote?: true;
}

/**
 * Where the named map (or, for `current`, the one the switch names) is
 * reached now: a remote map by its address, a local one by its adapter while
 * it runs; else nothing.
 */
export function reachOf(name: string, home = homeOf(), env: Record<string, string | undefined> = process.env): Reach | undefined {
  const map = name === CURRENT ? currentOf(home) : name;
  if (!map) return undefined;
  const r = remoteOf(map, home);
  if (r) {
    const base = r.url.replace(/\/+$/, "");
    const token = r.token_env ? env[r.token_env] : undefined;
    return { map, mcp: `${base}/mcp`, hook: `${base}/hook`, ...(token ? { token } : {}), remote: true };
  }
  const a = adapterOf(map, home);
  return a ? { map, mcp: `${a}/mcp`, hook: `${a}/hook` } : undefined;
}
