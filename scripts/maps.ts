/**
 * Maps by name, and the servers that serve them: the writing side of the
 * registry plugins/claude-code/registry.ts reads (issue #24).
 *
 * - A map is a data folder in one home (`<home>/maps/<name>/`), never inside
 *   a checkout, so removing a clone or a worktree takes no map with it.
 * - A server pairs one checkout with one map. It records itself in
 *   `<home>/servers/<name>.json` (`claim`), and a second server for the same
 *   map is refused, naming the one that runs.
 * - A server takes any free port (`freePort`): three in a row, the page's,
 *   the adapter's and the bridge's.
 *
 * app/server.ts `--map` and scripts/archipelago.ts use it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { alive, entryOf, homeOf, MAP_NAME, mapDir, serverFile, type Served } from "../plugins/claude-code/registry.ts";

export { alive, homeOf, MAP_NAME, mapDir, serverFile, servedOf, type PluginFolders, type Served } from "../plugins/claude-code/registry.ts";

/** Where free ports are looked for: above the fixed live (5180) and dev (5280) ones. */
export const PORTS_FROM = 5300;
const PORTS_TO = 6000;
const PORTS_STEP = 10;

/** A map's name from anything (a branch: `claude/x` is `claude-x`), or undefined when nothing is left. */
export function nameFrom(raw: string): string | undefined {
  const n = raw.replace(/[^a-z0-9._-]+/gi, "-").replace(/^[-._]+|-+$/g, "").slice(0, 64);
  return MAP_NAME.test(n) ? n : undefined;
}

/** The map a checkout serves when none is named: its branch's, or `dev` when it has none. */
export function defaultMap(checkout: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (branch && branch !== "HEAD") return nameFrom(branch) ?? "dev";
  } catch {}
  return "dev";
}

/** A checkout's commit, short, with `+` when it has changes; undefined outside git. */
export function commitOf(checkout: string): string | undefined {
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return git("rev-parse", "--short", "HEAD") + (git("status", "--porcelain", "--untracked-files=no") ? "+" : "");
  } catch {
    return undefined;
  }
}

/** Every entry in the registry, with whether its process is there. */
export function servers(home = homeOf()): (Served & { running: boolean })[] {
  let names: string[];
  try {
    names = readdirSync(join(home, "servers")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const e = entryOf(n, home);
    return e ? [{ ...e, running: alive(e.pid) }] : [];
  });
}

/**
 * Records a server for its map. Refused, with the one that runs, when
 * another process serves it; an entry whose process is gone is taken over.
 */
export function claim(entry: Served, home = homeOf()): { ok: true } | { ok: false; running: Served } {
  if (!MAP_NAME.test(entry.map)) throw new Error(`not a map name: ${entry.map}`);
  const file = serverFile(entry.map, home);
  mkdirSync(join(home, "servers"), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(file, JSON.stringify(entry, null, 2), { flag: "wx" });
      return { ok: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const was = entryOf(entry.map, home);
      if (was && was.pid !== entry.pid && alive(was.pid)) return { ok: false, running: was };
      rmSync(file, { force: true });
    }
  }
  return { ok: false, running: entryOf(entry.map, home)! };
}

/** Changes a server's entry, while it is still this process's. */
export function update(map: string, pid: number, patch: Partial<Served>, home = homeOf()): void {
  const e = entryOf(map, home);
  if (e?.pid === pid) writeFileSync(serverFile(map, home), JSON.stringify({ ...e, ...patch }, null, 2));
}

/** Takes a server's entry out, when it is still that process's. */
export function release(map: string, pid: number, home = homeOf()): void {
  if (entryOf(map, home)?.pid === pid) rmSync(serverFile(map, home), { force: true });
}

const free = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });

/**
 * Holds a page port for this process: `<home>/ports/<port>` made exclusively,
 * so two servers starting at once never take the same one. A hold whose
 * process is gone is taken over, by one server only (`takeOver`). A hold that goes between the failed create
 * and its read (its process let the port go) is free: the create is tried
 * again. An empty one is still being written by the process that made it,
 * so it is held. `read` is the read of a hold, given only by tests.
 */
export function holdPort(port: number, pid = process.pid, home = homeOf(), read = (f: string) => readFileSync(f, "utf8")): boolean {
  const file = join(home, "ports", String(port));
  mkdirSync(join(home, "ports"), { recursive: true });
  for (let i = 0; i < 5; i++) {
    try {
      writeFileSync(file, String(pid), { flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    let text: string;
    try {
      text = read(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (!text.trim()) return false;
    const was = Number(text);
    if (was === pid) return true;
    if (alive(was)) return false;
    if (!takeOver(file, text, was, pid)) return false;
  }
  return false;
}

/**
 * Removes an abandoned hold, when this server is the one taking it over:
 * `<port>.<was>` made exclusively is the right to remove a hold of `was`, so
 * of two servers that read the same abandoned hold, only one removes it, and
 * the other, its turn come, finds the new hold and leaves it. False when
 * another server is taking it over now.
 */
function takeOver(file: string, text: string, was: number, pid: number): boolean {
  const right = `${file}.${was}`;
  try {
    writeFileSync(right, String(pid), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    let taker = "";
    try {
      taker = readFileSync(right, "utf8");
    } catch {}
    // Being written, or its taker still working: theirs. Its taker gone: try again.
    if (!taker.trim() || alive(Number(taker))) return false;
    rmSync(right, { force: true });
    return true;
  }
  try {
    if (readFileSync(file, "utf8") === text) rmSync(file, { force: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  } finally {
    rmSync(right, { force: true });
  }
  return true;
}

/** Which of a page's three ports (page, adapter, bridge) something else already listens on. */
export async function takenOf(page: number): Promise<number[]> {
  const taken: number[] = [];
  for (const p of [page, page + 1, page + 2]) if (!(await free(p))) taken.push(p);
  return taken;
}

/** One line for a server whose fixed ports are taken: which, and the command that takes free ones. */
export function takenLine(page: number, taken: number[]): string {
  const which = taken.length === 1 ? `port ${taken[0]} is` : `ports ${taken.join(", ")} are`;
  return `refused: ${which} already taken (another Archipelago, or another program), so this server can't use ${page}-${page + 2}. Run npm run map -- serve for a map on free ports, or give --port another one.`;
}

/** Lets a held port go, when it is still this process's. */
export function letPortGo(port: number, pid = process.pid, home = homeOf()): void {
  const file = join(home, "ports", String(port));
  try {
    if (Number(readFileSync(file, "utf8")) === pid) rmSync(file, { force: true });
  } catch {}
}

/** A page port whose adapter and bridge ports are free too, held for this process (`holdPort`): let it go with `letPortGo`. */
export async function freePort(home = homeOf(), from = PORTS_FROM, pid = process.pid): Promise<number> {
  for (let p = from; p < PORTS_TO; p += PORTS_STEP) {
    if (!holdPort(p, pid, home)) continue;
    if ((await free(p)) && (await free(p + 1)) && (await free(p + 2))) return p;
    letPortGo(p, pid, home);
  }
  throw new Error(`no three free ports in a row between ${from} and ${PORTS_TO}`);
}

/** Whether a data folder holds a map yet. */
export const hasMap = (dir: string) => existsSync(join(dir, "graph.sqlite"));

/** Where `--from` copies from: a map by name (a copy), else a data folder (an older server's, moved in: `takeover`). */
export function sourceOf(from: string, home = homeOf()): { dir: string; takeover: boolean } {
  if (MAP_NAME.test(from) && hasMap(mapDir(from, home))) return { dir: mapDir(from, home), takeover: false };
  const dir = resolve(from);
  if (hasMap(dir)) return { dir, takeover: true };
  throw new Error(`nothing to copy from: no map named ${from}, and no graph.sqlite in ${dir}`);
}

/** What a server keeps of its own beside its map: what its writers wrote into folders (connect, lean), and live's moves. */
export const LEDGERS = ["connect.json", "lean.json", "promotions.log"];

/**
 * Copies a data folder's graph, schema, history and exchange journal,
 * consistent even while a server writes them, and its pictures and archives.
 * `takeover`: the folder is an older server's being moved in, not a map
 * being copied, so its ledgers come too (`LEDGERS`): the new server then
 * replaces what the old one wrote in its connected folders with its own,
 * and live's moves stay on record.
 */
export function snapshot(from: string, to: string, { takeover = false } = {}): void {
  mkdirSync(to, { recursive: true });
  for (const dir of ["files", "archives"]) if (existsSync(join(from, dir)) && !existsSync(join(to, dir))) cpSync(join(from, dir), join(to, dir), { recursive: true });
  // The plugin folders it loads come along, so a copy of live loads what live does (runtime/folders.ts).
  if (existsSync(join(from, "plugins.json")) && !existsSync(join(to, "plugins.json"))) copyFileSync(join(from, "plugins.json"), join(to, "plugins.json"));
  if (takeover) for (const f of LEDGERS) if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f));
  copyMap(from, to);
}

function copyMap(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of ["graph.sqlite", "schema.sqlite", "history.sqlite"]) {
    const db = join(from, name);
    if (!existsSync(db)) continue;
    for (const f of [name, `${name}-wal`, `${name}-shm`]) rmSync(join(to, f), { force: true });
    const src = new DatabaseSync(db, { readOnly: true });
    src.exec(`VACUUM INTO '${join(to, name).replaceAll("'", "''")}'`);
    src.close();
  }
  const journal = join(from, "exchange.jsonl");
  if (existsSync(journal)) {
    const text = readFileSync(journal);
    // Up to the last whole line: a write may be under way.
    writeFileSync(join(to, "exchange.jsonl"), text.subarray(0, text.lastIndexOf(10) + 1));
  }
}

/** The folders that report to a map: those its connect writer wrote an `.mcp.json` into (its ledger, `connect.json`). */
export function reporting(data: string): string[] {
  try {
    // The ledger as the writer keeps it (plugins/project-files saveLedger): `{ files: { <path>: ... } }`.
    const ledger = (JSON.parse(readFileSync(join(data, "connect.json"), "utf8")) as { files?: Record<string, unknown> }).files ?? {};
    return Object.keys(ledger)
      .filter((f) => /[\\/]\.mcp\.json$/.test(f))
      .map((f) => f.slice(0, -"/.mcp.json".length));
  } catch {
    return [];
  }
}
