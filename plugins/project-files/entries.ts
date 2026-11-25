/**
 * What a writer keeps in a file of someone else's (a project's settings, its
 * `.mcp.json`, git's exclude): entries, each added when wanted and taken out
 * when not, and never one the file had before. Plain data, no I/O: write.ts
 * reads and writes, the writers' tests check this.
 *
 * - An entry in JSON is an item of the list at a path (`item`), or a key of
 *   the object at a path (`key`, `value`); in a text file, a line.
 * - What is ours is what we added and is still there as we left it: an entry
 *   the person took out or changed by hand is theirs from then on.
 * - A list or object we left empty goes; a file we made goes when nothing is
 *   left in it.
 */
import type { Json } from "../../spec/common.ts";

export type Entry = { at: string[]; item: Json } | { at: string[]; key: string; value: Json } | { line: string };

/** What one file holds of ours. */
export interface Ours {
  entries: Entry[];
  /** The file was not there before: it goes when nothing is left in it. */
  created?: boolean;
  /** Its folder was not there either: it goes with the file, when empty. */
  dir?: boolean;
}

export type Outcome = { text?: string; ours: Ours; same: boolean } | { error: string };

type Obj = { [key: string]: Json };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const sameEntry = (a: Entry, b: Entry) => same(a, b);

/** The container at a path, made on the way when `make`. */
function at(root: Obj, path: string[], make: boolean, leaf: "list" | "object"): Json[] | Obj | undefined {
  let o: Obj = root;
  for (let i = 0; i < path.length; i++) {
    const k = path[i]!;
    const last = i === path.length - 1;
    let v = o[k];
    if (v === undefined) {
      if (!make) return undefined;
      v = last && leaf === "list" ? [] : {};
      o[k] = v;
    }
    if (last) return leaf === "list" ? (Array.isArray(v) ? v : undefined) : isObj(v) ? v : undefined;
    if (!isObj(v)) return undefined;
    o = v;
  }
  return o;
}

/** Whether an entry is in the file as we would leave it. */
function present(root: Obj, e: Entry): boolean {
  if ("line" in e) return false;
  if ("item" in e) return ((at(root, e.at, false, "list") as Json[] | undefined) ?? []).some((x) => same(x, e.item));
  const o = at(root, e.at, false, "object") as Obj | undefined;
  return !!o && e.key in o && same(o[e.key], e.value);
}

/** Takes an entry out, and the lists and objects on its path it leaves empty. */
function remove(root: Obj, e: Entry): void {
  if ("line" in e) return;
  if ("item" in e) {
    const l = at(root, e.at, false, "list") as Json[] | undefined;
    const i = l?.findIndex((x) => same(x, e.item)) ?? -1;
    if (i >= 0) l!.splice(i, 1);
  } else {
    const o = at(root, e.at, false, "object") as Obj | undefined;
    if (o) delete o[e.key];
  }
  for (let n = e.at.length; n > 0; n--) {
    const parent = n === 1 ? root : (at(root, e.at.slice(0, n - 1), false, "object") as Obj | undefined);
    const v = parent?.[e.at[n - 1]!];
    if (!parent || !((Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length))) break;
    delete parent[e.at[n - 1]!];
  }
}

/** Puts an entry in; false when it can't (its path holds something else, or the key is the person's). */
function add(root: Obj, e: Entry): boolean {
  if ("line" in e) return false;
  if ("item" in e) {
    const l = at(root, e.at, true, "list") as Json[] | undefined;
    if (!l) return false;
    l.push(e.item);
    return true;
  }
  const o = at(root, e.at, true, "object") as Obj | undefined;
  if (!o || e.key in o) return false;
  o[e.key] = e.value;
  return true;
}

/**
 * A JSON file brought to what is wanted of ours. `text` undefined: no file.
 * Answers the new text (undefined: remove the file), what is ours now, and
 * `same` when nothing changes; an error when the file isn't a JSON object.
 */
export function reconcileJson(text: string | undefined, had: Ours | undefined, want: Entry[]): Outcome {
  let root: Obj = {};
  if (text !== undefined) {
    try {
      const v = JSON.parse(text) as unknown;
      if (!isObj(v)) return { error: "it is not a JSON object" };
      root = v;
    } catch {
      return { error: "it is not JSON" };
    }
  }
  const before = JSON.stringify(root);
  const created = had?.created || (text === undefined && !had);
  // Ours the person took out or changed: theirs now. Ours no longer wanted: out.
  let mine = (had?.entries ?? []).filter((e) => present(root, e));
  for (const e of mine) if (!want.some((w) => sameEntry(w, e))) remove(root, e);
  mine = mine.filter((e) => want.some((w) => sameEntry(w, e)));
  for (const w of want) {
    if (mine.some((e) => sameEntry(e, w)) || present(root, w)) continue;
    if (add(root, w)) mine.push(w);
  }
  const ours: Ours = { entries: mine, ...(created ? { created: true } : {}), ...(had?.dir ? { dir: true } : {}) };
  if (JSON.stringify(root) === before) return { ours, same: true, ...(text !== undefined ? { text } : {}) };
  if (created && !Object.keys(root).length) return { ours: { ...ours, entries: [] }, same: false };
  return { text: JSON.stringify(root, null, 2) + "\n", ours, same: false };
}

/** A text file (git's exclude) brought to what is wanted of ours, a line each: as reconcileJson. */
export function reconcileLines(text: string | undefined, had: Ours | undefined, want: Entry[]): Outcome {
  const lines = text === undefined || text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const before = lines.join("\n");
  const created = had?.created || (text === undefined && !had);
  const wanted = want.flatMap((w) => ("line" in w ? [w.line] : []));
  let mine = (had?.entries ?? []).flatMap((e) => ("line" in e && lines.includes(e.line) ? [e.line] : []));
  const out = lines.filter((l) => wanted.includes(l) || !mine.includes(l));
  mine = mine.filter((l) => wanted.includes(l));
  for (const l of wanted) if (!out.includes(l)) out.push(l), mine.push(l);
  const ours: Ours = { entries: mine.map((line) => ({ line })), ...(created ? { created: true } : {}), ...(had?.dir ? { dir: true } : {}) };
  if (out.join("\n") === before) return { ours, same: true, ...(text !== undefined ? { text } : {}) };
  if (created && !out.length) return { ours: { ...ours, entries: [] }, same: false };
  return { text: out.length ? out.join("\n") + "\n" : "", ours, same: false };
}
