/**
 * What the find line offers as you type: pure, over the same index the
 * query runs on. The last word of the line is the one being typed.
 *
 * - `term`: a term to put in place of that word, by kind: a key (`type:`),
 *   a side (`is:open`), a type, a status, or an item as `in:`/`near:`/`id:`.
 * - `item`: an item whose title holds every plain word of the line. Picking
 *   one jumps to it.
 *
 * And the rule for a jump: the item is looked at, and if the line's query
 * does not draw it, the query becomes `near:<id>`, so every view shows it
 * among its neighbours.
 */
import type { Id } from "../../spec/common.ts";
import { closed, parse, run, type Index, type Row } from "./query.ts";

export type Kind = "key" | "side" | "type" | "status" | "item";

export type Suggestion =
  | { kind: "term"; of: Kind; term: string; line: string; hint?: string }
  | { kind: "item"; id: Id; title: string; type: string; status: string }
  | { kind: "offer"; key: string; of: string; title: string; hint?: string; run: () => void };

/**
 * What another plugin offers the command line (`find.offer`): rows for the
 * words typed, each run when picked. Views offer themselves here, so Ctrl+K
 * opens a view as it jumps to an item.
 */
export interface Offer {
  /** A word or two for the kind of row, shown at its left, e.g. `view`. */
  of: string;
  /** The rows for these words, at most `limit`. */
  list(words: string[], limit: number): { key: string; title: string; hint?: string; run: () => void }[];
}

/** Every offer's rows for `line`, as suggestions. */
export function offered(offers: Iterable<Offer>, line: string, limit = 4): Suggestion[] {
  const words = parse(line).words;
  return [...offers].flatMap((o) => o.list(words, limit).map((r) => ({ kind: "offer" as const, of: o.of, ...r })));
}

const KEYS = ["is", "status", "type", "in", "near", "id", "as_of"] as const;
const KEY_HINT: Record<(typeof KEYS)[number], string> = {
  is: "open or closed",
  status: "a status",
  type: "a type or its base",
  in: "an item and its parts",
  near: "an item and its neighbours",
  id: "one item",
  as_of: "records true on a date",
};

/** The line with its last word replaced by `term`, ready for the next word (a key waits for its value). */
export function complete(line: string, term: string): string {
  const head = /\s$/.test(line) ? line : line.replace(/\S+$/, "");
  return head + term + (term.endsWith(":") ? "" : " ");
}

/** Items whose titles hold every word, the best first: a title starting with the first word, open before closed, shorter. */
function titled(index: Index, words: string[], limit: number): Row[] {
  if (!words.length) return [];
  const lead = words[0]!;
  const scored: [number, number, Row][] = [];
  for (const r of index.items.values()) {
    const title = String(r.fields.title ?? "").toLowerCase();
    if (!words.every((w) => title.includes(w))) continue;
    const score = (title.startsWith(lead) ? 0 : 2) + (closed(index.type(r.type), r.fields.status) ? 1 : 0);
    scored.push([score, title.length, r]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((s) => s[2]);
}

const asItem = (r: Row): Suggestion => ({ kind: "item", id: r.id, title: String(r.fields.title ?? r.id), type: r.type, status: String(r.fields.status ?? "") });

/** What to offer for `line`: terms first, then items to jump to; at most `limit` of each. */
export function suggest(index: Index, line: string, limit = 6): Suggestion[] {
  const last = /\s$/.test(line) ? "" : (line.trim().split(/\s+/).pop() ?? "");
  const word = last.toLowerCase();
  const types = new Map<string, { base: string; statuses: Set<string> }>();
  for (const r of index.items.values()) {
    if (types.has(r.type)) continue;
    const t = index.type(r.type);
    types.set(r.type, { base: t?.base ?? r.type, statuses: new Set([...(t?.statuses.open ?? []), ...(t?.statuses.closed ?? [])]) });
  }
  const typeNames = [...new Set([...types.keys(), ...[...types.values()].map((t) => t.base)])].sort();
  const statuses = [...new Set([...types.values()].flatMap((t) => [...t.statuses]))].sort();
  const term = (of: Kind, t: string, hint?: string): Suggestion => ({ kind: "term", of, term: t, line: complete(line, t), hint });
  const terms: Suggestion[] = [];

  const key = /^(\w+):(.*)$/.exec(word);
  if (key && (KEYS as readonly string[]).includes(key[1]!)) {
    const [, k, v] = key as unknown as [string, (typeof KEYS)[number], string];
    if (k === "is") for (const s of ["open", "closed"]) s.startsWith(v) && terms.push(term("side", `is:${s}`));
    if (k === "type") for (const t of typeNames) t.startsWith(v) && terms.push(term("type", `type:${t}`));
    if (k === "status") for (const s of statuses) s.startsWith(v) && terms.push(term("status", `status:${s}`));
    // A date: today's, as the shape to edit.
    if (k === "as_of" && !v) terms.push(term("key", `as_of:${v || new Date().toISOString().slice(0, 10)}`, "a date, YYYY-MM-DD"));
    if (k === "in" || k === "near" || k === "id") {
      const byId = v ? [...index.items.values()].filter((r) => r.id.toLowerCase().startsWith(v)) : [];
      for (const r of [...byId, ...titled(index, v ? [v] : [], limit)].slice(0, limit))
        terms.push(term("item", `${k}:${r.id}`, String(r.fields.title ?? r.id)));
    }
    return dedupe(terms).slice(0, limit);
  }

  if (word) {
    for (const k of KEYS) k.startsWith(word) && terms.push(term("key", `${k}:`, KEY_HINT[k]));
    for (const s of ["open", "closed"]) s.startsWith(word) && terms.push(term("side", `is:${s}`));
    for (const t of typeNames) t.startsWith(word) && terms.push(term("type", `type:${t}`));
    for (const s of statuses) s.startsWith(word) && terms.push(term("status", `status:${s}`));
  }
  const items = titled(index, parse(line).words, limit).map(asItem);
  return [...dedupe(terms).slice(0, Math.max(2, limit - items.length)), ...items];
}

function dedupe(s: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return s.filter((x) => {
    const k = x.kind === "term" ? x.term : x.kind === "offer" ? x.key : x.id;
    return !seen.has(k) && (seen.add(k), true);
  });
}

/** The query to show `id` with: the line's own when it draws the item, else `near:<id>`. */
export function jumpQuery(index: Index, query: string, id: Id): string {
  return run(index, query).items.some((r) => r.id === id) ? query : `near:${id}`;
}
