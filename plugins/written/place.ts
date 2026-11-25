/**
 * Where the written plugin writes a node's file: `written.place`, a plugin-own
 * key (like `verdict.read`). By default a node's file is its `file`. A
 * placer (another plugin) may answer for a node with the files it should be
 * written to instead, so a file loads only where it fits (plugins/placed puts
 * a profile's skills into the folders of the runs it holds them for). The
 * written plugin never knows why.
 *
 * - `placer(def)`: adds a placer, as the caller's revertible effect. Asked
 *   in config-tree order; the first that answers (a list, maybe empty)
 *   decides. Nothing: the node's own `file`.
 * - `changed()`: what a placer answers has changed; every node is placed
 *   again.
 *
 * When `file` isn't among the answer, the written plugin takes its file away
 * (only if the file is still the map's words) and puts it back when the
 * placer stops answering or the plugin unloads. A copy is written only where
 * nothing is, or over what this plugin wrote there, and removed the same way.
 */
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Caller, Dispose } from "../../spec/common.ts";
import { byPosition } from "../../spec/common.ts";
import type { Item } from "../../spec/graph.ts";

export const KEY = "written.place";

export interface Placer {
  /** Unique within the plugin. */
  name: string;
  /** The files a node is written to, or nothing: not this placer's to say. */
  files(node: Item): string[] | null | Promise<string[] | null>;
}

export interface WrittenPlace {
  placer(def: Placer): Dispose;
  changed(): void;
}

export const fold = (f: string) => f.replaceAll("\\", "/").replace(/^[a-z]:\//i, (d) => d.toLowerCase());

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

export interface Placers {
  add(def: Placer, caller: Caller): Dispose;
  /** The first answer in config-tree order, or null. A placer that throws is reported and passed over. */
  ask(node: Item, report: (e: unknown) => void): Promise<string[] | null>;
  readonly size: number;
}

export function placers(): Placers {
  const all = new Map<string, { def: Placer; caller: Caller; seq: number }>();
  let seq = 0;
  return {
    add(def, caller) {
      const id = `${caller.plugin}/${def.name}`;
      all.set(id, { def, caller, seq: seq++ });
      return () => void all.delete(id);
    },
    async ask(node, report) {
      for (const p of [...all.values()].sort((a, b) => byPosition(a.caller, b.caller) || a.seq - b.seq)) {
        try {
          const files = await p.def.files(node);
          if (Array.isArray(files)) return files.filter((f) => typeof f === "string" && f);
        } catch (err) {
          report(err);
        }
      }
      return null;
    },
    get size() {
      return all.size;
    },
  };
}

/** Copies of nodes' files, and home files taken away: what to undo when the plugin unloads. */
export class Copies {
  /** Per node: folded path → the file and what was last written there. */
  private copies = new Map<string, Map<string, { file: string; last: string }>>();
  /** Per node: its own file taken away, and the text to put back. */
  private away = new Map<string, { file: string; text: string }>();

  private report: (e: unknown) => void;

  constructor(report: (e: unknown) => void) {
    this.report = report;
  }

  /** Writes the node's words to each copy, and removes copies it no longer has. */
  async place(id: string, files: string[], words: string): Promise<void> {
    const had = this.copies.get(id) ?? new Map<string, { file: string; last: string }>();
    const want = new Map(files.map((f) => [fold(f), f]));
    for (const [k, c] of [...had]) {
      if (want.has(k)) continue;
      await this.remove(c.file, c.last);
      had.delete(k);
    }
    for (const [k, file] of want) {
      const disk = await readText(file);
      const known = had.get(k);
      if (disk === words) {
        had.set(k, { file, last: words });
        continue;
      }
      if (disk !== undefined && disk !== known?.last) {
        this.report(new Error(`written: ${file} is there and isn't the map's, so it is left as it is.`));
        continue;
      }
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, words, "utf8");
      had.set(k, { file, last: words });
    }
    if (had.size) this.copies.set(id, had);
    else this.copies.delete(id);
  }

  /** Takes a node's own file away, if it holds the map's words. */
  async takeAway(id: string, file: string, words: string, last: string | undefined): Promise<void> {
    if (this.away.has(id)) return;
    const disk = await readText(file);
    if (disk === undefined) return;
    if (disk !== words && disk !== last) {
      this.report(new Error(`written: ${file} changed outside the map, so it is left where it is.`));
      return;
    }
    await unlink(file);
    this.away.set(id, { file, text: disk });
  }

  /** Puts a node's own file back, if nothing took its place. */
  async putBack(id: string): Promise<void> {
    const a = this.away.get(id);
    if (!a) return;
    this.away.delete(id);
    if ((await readText(a.file)) !== undefined) return;
    await mkdir(dirname(a.file), { recursive: true });
    await writeFile(a.file, a.text, "utf8");
  }

  isAway(id: string): boolean {
    return this.away.has(id);
  }

  /** Every copy removed and every file put back: the plugin is leaving. */
  async undoAll(): Promise<void> {
    for (const [, had] of this.copies) for (const c of had.values()) await this.remove(c.file, c.last);
    this.copies.clear();
    for (const id of [...this.away.keys()]) await this.putBack(id);
  }

  private async remove(file: string, last: string): Promise<void> {
    if ((await readText(file)) !== last) return;
    await unlink(file);
    try {
      await rmdir(dirname(file));
    } catch {
      // Not empty: the folder had other files.
    }
  }
}
