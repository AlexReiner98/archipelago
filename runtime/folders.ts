/**
 * Plugin folders: plugins kept outside this repository, in a folder of
 * their own (another repository, say), loaded beside the ones here.
 *
 * A folder says what it adds in `archipelago.json`:
 *
 *   { "name": "design",
 *     "server": [{ "id": "reciprocal", "plugin": "reciprocal/map.ts" }],
 *     "page":   [{ "id": "reciprocal", "plugin": "reciprocal/index.ts" }] }
 *
 * Paths are relative to the folder. The server's entries are loaded from
 * the folder's files; the page's are served at `/ext/<name>/` (serve.ts)
 * and listed at `/app/plugins.json`, which the page adds to its tree
 * (app/boot.ts). A folder's code imports this repository by its package
 * name, `archipelago/spec/graph.ts`: Node finds it through the folder's
 * own `node_modules`, and the page server rewrites it to `/spec/graph.ts`.
 *
 * Which folders a server loads: `--plugins`, else `ARCHIPELAGO_PLUGINS`,
 * else the ones its map remembers, in `<data>/plugins.json` (`npm run map
 * -- plugins add <dir>`), so a restart brings them back with no variable
 * set. A folder that can't be read is left out, in one line (`loadFolders`).
 *
 * Node only. A folder's plugins are trusted like any other: there is no
 * sandbox.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Entry } from "./loader.ts";

/** What a folder's name may be: it is a path segment of the page's URLs. */
export const FOLDER_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The file a folder says what it adds in. */
export const MANIFEST = "archipelago.json";

export interface Folder {
  name: string;
  /** The folder, absolute. */
  dir: string;
  /** Entries as the folder gives them, paths relative to it. */
  server: Entry[];
  page: Entry[];
}

const entries = (v: unknown, where: string, dir: string): Entry[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${where}: a list of entries`);
  return v.map((e, i) => {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || (e.plugin !== undefined && typeof e.plugin !== "string"))
      throw new Error(`${where}[${i}]: an entry is { id, plugin }`);
    if (e.plugin !== undefined) {
      const file = resolve(dir, e.plugin);
      if (isAbsolute(e.plugin) || !file.startsWith(dir + sep)) throw new Error(`${where}[${i}]: ${e.plugin} is not inside the folder`);
    }
    return e as Entry;
  });
};

/** Reads a folder's manifest; throws, saying what to fix, when it won't do. */
export function readFolder(dir: string): Folder {
  const abs = resolve(dir);
  const file = join(abs, MANIFEST);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`plugin folder ${abs}: no readable ${MANIFEST} (${(e as Error).message})`);
  }
  const m = raw as { name?: unknown; server?: unknown; page?: unknown };
  if (typeof m.name !== "string" || !FOLDER_NAME.test(m.name))
    throw new Error(`${file}: "name" is lowercase letters, digits, ".", "_" and "-", as it is part of the page's URLs`);
  return { name: m.name, dir: abs, server: entries(m.server, `${file} server`, abs), page: entries(m.page, `${file} page`, abs) };
}

/** The folders a list names (`--plugins`, or `ARCHIPELAGO_PLUGINS` split on the path delimiter). Two of one name are refused. */
export function readFolders(dirs: string[]): Folder[] {
  const out: Folder[] = [];
  for (const d of dirs.filter(Boolean)) {
    const f = readFolder(d);
    const twin = out.find((x) => x.name === f.name);
    if (twin) throw new Error(`plugin folders ${twin.dir} and ${f.dir} are both named ${f.name}`);
    out.push(f);
  }
  return out;
}

/** `ARCHIPELAGO_PLUGINS` as a list of folders. */
export const foldersOf = (env: string | undefined): string[] => (env ? env.split(delimiter).filter(Boolean) : []);

/** The file in a map's data that names the folders it loads: `{ "folders": [<dir>, …] }`, each absolute. */
export const REMEMBERED = "plugins.json";

/** Where a server's folder list came from: `--plugins`, `ARCHIPELAGO_PLUGINS`, or the map's own `plugins.json`. */
export type FoldersFrom = "flag" | "env" | "map";

/** The folders a map remembers; none when it remembers none. Throws when the file is there but not a list. */
export function remembered(data: string): string[] {
  const file = join(data, REMEMBERED);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8")) as { folders?: unknown };
  if (!Array.isArray(raw.folders) || raw.folders.some((d) => typeof d !== "string")) throw new Error(`${file}: { "folders": [<dir>, …] }`);
  return raw.folders as string[];
}

function rememberAll(data: string, dirs: string[]): void {
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, REMEMBERED), JSON.stringify({ folders: dirs }, null, 2) + "\n");
}

const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Adds a folder to the ones a map remembers, read first: refused (throws) when it won't load or its name is taken. Returns it as read. */
export function remember(data: string, dir: string): Folder {
  const f = readFolder(dir);
  const dirs = remembered(data);
  if (dirs.some((d) => same(resolve(d), f.dir))) return f;
  for (const d of dirs) {
    let other: Folder;
    try {
      other = readFolder(d);
    } catch {
      continue;
    }
    if (other.name === f.name) throw new Error(`the map already loads a folder named ${f.name}, from ${other.dir}: npm run map -- plugins rm ${other.dir}`);
  }
  rememberAll(data, [...dirs, f.dir]);
  return f;
}

/** Takes a folder out of the ones a map remembers, by its folder or its name; the folder taken out, or undefined when none matched. */
export function forget(data: string, dirOrName: string): string | undefined {
  const dirs = remembered(data);
  const hit = dirs.find((d) => same(resolve(d), resolve(dirOrName))) ?? dirs.find((d) => {
    try {
      return readFolder(d).name === dirOrName;
    } catch {
      return false;
    }
  });
  if (hit) rememberAll(data, dirs.filter((d) => d !== hit));
  return hit;
}

/** Which folders a server loads, and from where: `--plugins` when given, else `ARCHIPELAGO_PLUGINS` when set, else what the map remembers. */
export function chooseFolders({ flag = [], env, data }: { flag?: string[]; env?: string; data: string }): { dirs: string[]; from?: FoldersFrom } {
  if (flag.length) return { dirs: flag, from: "flag" };
  const e = foldersOf(env);
  if (e.length) return { dirs: e, from: "env" };
  const m = remembered(data);
  return m.length ? { dirs: m, from: "map" } : { dirs: [] };
}

/** A folder named but not loaded, and why. */
export interface Missing {
  dir: string;
  why: string;
}

/** The folders a list names that load; each that doesn't (gone, no manifest, a twin's name) is left out with why, so the rest still start. */
export function loadFolders(dirs: string[]): { folders: Folder[]; missing: Missing[] } {
  const folders: Folder[] = [];
  const missing: Missing[] = [];
  for (const d of dirs.filter(Boolean)) {
    const dir = resolve(d);
    if (!existsSync(dir)) {
      missing.push({ dir, why: "the folder isn't there" });
      continue;
    }
    try {
      const f = readFolder(dir);
      const twin = folders.find((x) => x.name === f.name);
      if (twin) missing.push({ dir, why: `${twin.dir} is named ${f.name} too, and came first` });
      else folders.push(f);
    } catch (e) {
      missing.push({ dir, why: (e as Error).message });
    }
  }
  return { folders, missing };
}

/** The line a server says for a folder it couldn't load. */
export const missingLine = (m: Missing, from?: FoldersFrom) =>
  `plugin folder ${m.dir}${from ? ` (${FROM_WORDS[from]})` : ""} is not loaded: ${m.why}`;

/** How a person reads where a folder list came from. */
export const FROM_WORDS: Record<FoldersFrom, string> = {
  flag: "from --plugins",
  env: "from ARCHIPELAGO_PLUGINS",
  map: "remembered by the map",
};

/** What the server says of itself to a folder's entries. */
export interface ServerOf {
  /** Whether it writes files outside its data (skills, settings): an entry that says `"writes": true` is off when not. */
  write?: boolean;
  /** The map's data folder, given to each entry whose config is an object (or none) as `config.data`: where it keeps a ledger, say. */
  data?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The server's entries for the folders, each plugin a file URL. */
export const serverEntries = (folders: Folder[], server: ServerOf = {}): Entry[] =>
  folders.flatMap((f) =>
    f.server.map((raw) => {
      const { writes, ...e } = raw as Entry & { writes?: boolean };
      const out: Entry = e.plugin ? { ...e, plugin: pathToFileURL(join(f.dir, e.plugin)).href } : { ...e };
      if (writes && server.write === false) out.disabled = true;
      if (server.data !== undefined && e.plugin && (e.config === undefined || isObject(e.config))) out.config = { data: server.data, ...(e.config ?? {}) };
      return out;
    }),
  );

/** Where the page server serves a folder. */
export const mountOf = (name: string) => `/ext/${name}/`;

/** The page's entries for the folders, each plugin at its rooted URL. */
export const pageEntries = (folders: Folder[]): Entry[] =>
  folders.flatMap((f) => f.page.map((e) => (e.plugin ? { ...e, plugin: mountOf(f.name) + e.plugin.replaceAll("\\", "/") } : e)));

/** The page server's mounts: each folder's name to its folder. */
export const mounts = (folders: Folder[]): Record<string, string> => Object.fromEntries(folders.map((f) => [f.name, f.dir]));
