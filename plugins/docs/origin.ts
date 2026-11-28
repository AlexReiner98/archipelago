/**
 * Where a plugin came from and when it last changed, read from what is
 * already there: the folder its module is in, the git history of that
 * folder, the nearest `package.json`, and its files' times. No plugin
 * declares a version for this. Server side (it reads files and runs git);
 * the docs plugin hands it to each card as `origin`.
 *
 * - From this repository: its folder (`plugins/docs`), the last commit that
 *   changed it and that commit's date; when the folder has edits not
 *   committed, `edited` and the newest file's time.
 * - From outside: its folder's name, the version its `package.json` gives,
 *   and its git commit when the folder is in a repository; else the newest
 *   file's time.
 *
 * Kept for `fresh` ms per folder, so a page that reads every second runs
 * git at most that often.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Origin } from "./read.ts";

export type { Origin } from "./read.ts";

/** Runs git in a folder: its output, or undefined when it failed. Replaced in tests. */
export type Git = (cwd: string, args: string[]) => Promise<string | undefined>;

export const realGit: Git = (cwd, args) =>
  new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined));
  });

/** How many files of a folder are looked at for its newest time. */
const FILES = 200;

/** The newest modification time of a folder's files (bounded, `node_modules` and `.git` left out). */
export async function newest(dir: string): Promise<number | undefined> {
  let best: number | undefined;
  let seen = 0;
  const walk = async (d: string, depth: number): Promise<void> => {
    const list = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of list) {
      if (seen >= FILES) return;
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 3) await walk(p, depth + 1);
        continue;
      }
      seen++;
      const s = await stat(p).catch(() => undefined);
      if (s && (best === undefined || s.mtimeMs > best)) best = s.mtimeMs;
    }
  };
  await walk(dir, 0);
  return best;
}

/** The nearest `package.json` at or above `dir`, up to `up` folders: its name and version. */
async function pkg(dir: string, up = 3): Promise<{ name?: string; version?: string } | undefined> {
  for (let d = dir, i = 0; i <= up; i++, d = dirname(d)) {
    const text = await readFile(join(d, "package.json"), "utf8").catch(() => undefined);
    if (text !== undefined) {
      try {
        const j = JSON.parse(text) as { name?: unknown; version?: unknown };
        return { ...(typeof j.name === "string" ? { name: j.name } : {}), ...(typeof j.version === "string" ? { version: j.version } : {}) };
      } catch {
        return undefined;
      }
    }
    if (dirname(d) === d) break;
  }
  return undefined;
}

/** The last commit that changed `dir` (short hash and date), and whether it has edits not committed. */
async function history(git: Git, dir: string): Promise<{ commit?: string; date?: string; edited?: boolean }> {
  const [log, status] = await Promise.all([git(dir, ["log", "-1", "--format=%h%x09%cI", "--", "."]), git(dir, ["status", "--porcelain", "--", "."])]);
  const [commit, date] = (log ?? "").split("\t");
  return { ...(commit ? { commit } : {}), ...(date ? { date } : {}), ...(status ? { edited: true } : {}) };
}

export interface Origins {
  /** Each source's origin: a module's URL (`file:`), as the fiber's `source` holds it. */
  of(sources: string[]): Promise<Map<string, Origin>>;
}

/**
 * Origins for module URLs, `root` being this repository's root URL. Kept per
 * folder for `fresh` ms.
 */
export function origins(root: string, options: { git?: Git; fresh?: number; now?: () => number } = {}): Origins {
  const git = options.git ?? realGit;
  const fresh = options.fresh ?? 30_000;
  const now = options.now ?? Date.now;
  const rootDir = fileURLToPath(root);
  const kept = new Map<string, { at: number; origin: Promise<Origin | undefined> }>();

  const read = async (dir: string): Promise<Origin | undefined> => {
    const inside = !relative(rootDir, dir).startsWith("..") && !relative(rootDir, dir).includes(":");
    const [h, p] = await Promise.all([history(git, dir), inside ? undefined : pkg(dir)]);
    const changed = h.date && !h.edited ? h.date : await newest(dir).then((t) => (t === undefined ? h.date : new Date(t).toISOString()));
    return {
      from: inside ? "repository" : "outside",
      path: inside ? relative(rootDir, dir).split(sep).join("/") : basename(dir),
      ...(p?.name && !inside ? { name: p.name } : {}),
      ...(p?.version ? { version: p.version } : {}),
      ...(h.commit ? { commit: h.commit } : {}),
      ...(changed ? { changed } : {}),
      ...(h.edited ? { edited: true } : {}),
    };
  };

  return {
    async of(sources) {
      const out = new Map<string, Origin>();
      await Promise.all(
        [...new Set(sources)].map(async (src) => {
          if (!src.startsWith("file:")) return;
          const dir = dirname(fileURLToPath(src));
          let k = kept.get(dir);
          if (!k || now() - k.at > fresh) {
            k = { at: now(), origin: read(dir).catch(() => undefined) };
            kept.set(dir, k);
          }
          const o = await k.origin;
          if (o) out.set(src, o);
        }),
      );
      return out;
    },
  };
}
