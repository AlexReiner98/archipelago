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
 * Node only. A folder's plugins are trusted like any other: there is no
 * sandbox.
 */
import { readFileSync } from "node:fs";
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

/** The server's entries for the folders, each plugin a file URL. */
export const serverEntries = (folders: Folder[]): Entry[] =>
  folders.flatMap((f) => f.server.map((e) => (e.plugin ? { ...e, plugin: pathToFileURL(join(f.dir, e.plugin)).href } : e)));

/** Where the page server serves a folder. */
export const mountOf = (name: string) => `/ext/${name}/`;

/** The page's entries for the folders, each plugin at its rooted URL. */
export const pageEntries = (folders: Folder[]): Entry[] =>
  folders.flatMap((f) => f.page.map((e) => (e.plugin ? { ...e, plugin: mountOf(f.name) + e.plugin.replaceAll("\\", "/") } : e)));

/** The page server's mounts: each folder's name to its folder. */
export const mounts = (folders: Folder[]): Record<string, string> => Object.fromEntries(folders.map((f) => [f.name, f.dir]));
