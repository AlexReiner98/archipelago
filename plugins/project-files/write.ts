/**
 * Writing entries into files of someone else's, server side: each file
 * brought to what is wanted of ours (entries.ts), with a ledger of what we
 * added, so a later pass, an unload or a crash takes out exactly that. Used
 * by the writers that put what is on the map into a project's files (lean's,
 * connect's).
 *
 * - Only in a safe folder (`safeFolder`): absolute, there, not the home
 *   folder or above it, not a drive's root, nothing under `~/.claude`.
 * - A `.json` file is read as a JSON object, anything else as lines. A file
 *   that isn't what it should be is left alone and reported.
 * - A file we made goes when nothing is left in it, and its folder with it
 *   when we made that too and it is empty.
 */
import { mkdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { reconcileJson, reconcileLines, type Entry, type Ours } from "./entries.ts";

/** Per file (an absolute path), what we added to it. */
export type Ledger = Record<string, Ours>;

const fold = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === "" || (!!r && !r.startsWith("..") && !isAbsolute(r));
};

/** Whether a folder may be written in: absolute, a folder, not the home folder or one above it, a drive's root, or under ~/.claude. */
export async function safeFolder(folder: string, home: string): Promise<boolean> {
  if (!isAbsolute(folder)) return false;
  const f = resolve(folder);
  if (fold(f) === fold(home) || parse(f).root === f || f === dirname(f)) return false;
  if (inside(fold(f), fold(join(home, ".claude")))) return false;
  if (inside(fold(home), fold(f))) return false;
  try {
    return (await stat(f)).isDirectory();
  } catch {
    return false;
  }
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** A ledger kept in a file between loads: empty when it isn't there or can't be read. */
export async function loadLedger(file: string | undefined): Promise<Ledger> {
  if (!file) return {};
  try {
    return (JSON.parse((await readText(file)) ?? "{}") as { files?: Ledger }).files ?? {};
  } catch {
    return {};
  }
}

export async function saveLedger(file: string | undefined, ledger: Ledger): Promise<void> {
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ files: ledger }, null, 2) + "\n", "utf8");
}

/**
 * Brings every file wanted or in the ledger to what is wanted of ours
 * (nothing, for a file not in `want`), and the ledger with it. A file that
 * can't be read as it should is left as it is, and `report`ed.
 */
export async function bringTo(ledger: Ledger, want: Map<string, Entry[]>, report: (e: Error) => void, who: string): Promise<void> {
  for (const file of new Set([...want.keys(), ...Object.keys(ledger)])) {
    const w = want.get(file) ?? [];
    const had = ledger[file];
    if (!had && !w.length) continue;
    const text = await readText(file);
    const r = (file.endsWith(".json") ? reconcileJson : reconcileLines)(text, had, w);
    if ("error" in r) {
      report(new Error(`${who}: ${file.split(/[\\/]/).slice(-2).join("/")} is left as it is: ${r.error}.`));
      continue;
    }
    let ours = r.ours;
    if (!r.same) {
      if (r.text === undefined) {
        await rm(file, { force: true });
        if (had?.dir) await rmdir(dirname(file)).catch(() => undefined);
      } else {
        if (text === undefined && (await mkdir(dirname(file), { recursive: true }))) ours = { ...ours, dir: true };
        await writeFile(file, r.text, "utf8");
      }
    }
    if (ours.entries.length) ledger[file] = ours;
    else delete ledger[file];
  }
}
