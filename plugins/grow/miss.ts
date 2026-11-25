/**
 * Misses nothing covers, apart from the runtime: a run's exchange events
 * and the nodes loaded now in, the misses no node listens at out.
 *
 * A miss is a refusal, or an act that didn't work (`ok: false`), as the
 * verdict plugin reads them: an act stands at its place and at the files its
 * input names, made relative to the run's folder. A refusal with the code
 * `ask`, and the act it denies, are a question, not a miss. A miss is
 * covered when a node loaded now would plausibly have prevented it, as the
 * verdict plugin judges (`covers`): it listens at one of the miss's places
 * as narrowly as the miss allows (a file: pattern matching its file), or
 * its `misses` name the miss's words. So a node at tool:Bash covers a
 * failed Bash call only when its words say it is that miss. The asking
 * node itself doesn't count.
 *
 * Place matching follows spec/agent.md, written here (as in the verdict
 * plugin) so this plugin doesn't name another plugin.
 */
import type { NodeInfo, Place } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";

/** The refusal code of a question to the agent (the verdict plugin's ASK). */
export const ASK = "ask";

function familyOf(place: string): string {
  const i = place.indexOf(":");
  return i < 0 ? place : place.slice(0, i + 1);
}

export function placeMatches(pattern: Place, place: Place): boolean {
  if (pattern === place) return true;
  const fam = familyOf(pattern);
  if (fam !== familyOf(place) || !fam.endsWith(":")) return false;
  const re = pattern
    .slice(fam.length)
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${re}$`).test(place.slice(fam.length));
}

/** Words too common to say which miss a node is about. */
const COMMON = new Set(
  "the and for not but with that this then than was were are has have had its into from out off one all any can cannot could should would will you your when what which who how why there here use used using get got make made call called file files tool tools error errors failed fails fail failure because before after again only also just".split(" "),
);

/** The words that say what a text is about: lower case, three letters or more, the common ones left out. */
export function wordsOf(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().split(/[^a-z0-9_]+/)) if (w.length >= 3 && !COMMON.has(w)) out.add(w);
  return out;
}

/** Whether a node's `misses` name a miss's words: at least half of its words are in them. */
export function namesMiss(misses: string | undefined, words: string): boolean {
  const want = [...wordsOf(misses)];
  if (!want.length) return false;
  const have = wordsOf(words);
  return want.filter((w) => have.has(w)).length >= Math.max(1, Math.ceil(want.length / 2));
}

/** A file: pattern that names some files, not all of them (`file:**`, `file:*`). */
const narrowFile = (pattern: Place) => pattern.startsWith("file:") && /[^*/]/.test(pattern.slice(5));

/** The places a harness loads at (a skill, a memory file): what is said there speaks to the whole run. */
const LOAD_FAMILIES = ["skill:", "memory:"];
const atLoad = (at: Place[]) => at.length > 0 && at.every((a) => LOAD_FAMILIES.some((f) => a.startsWith(f)));

/** Where a node listens, and the words of the miss it should prevent, if it says. */
export interface Listener {
  at: Place[];
  misses?: string;
  /** Said only when the moment's input holds this (a refusal's node, at a tool's result). */
  when?: string;
}

/**
 * Whether a node would plausibly have prevented a miss: it listens at one
 * of the miss's places, and either it does so as narrowly as the miss
 * allows (a file: pattern matching the miss's file, not every file), or its
 * `misses` name the miss's words. A broad place alone (tool:Bash, said
 * before every Bash call) covers nothing: the words must say which miss.
 * A node said where the harness loads something (skill:, memory:) speaks to
 * the whole run, and nothing goes wrong at a load itself: its `misses`
 * alone decide, wherever the miss stands.
 */
export function covers(node: Listener, places: Place[], words: string): boolean {
  // A node said at a tool's result when the result holds its `when` (a refusal's node) is that miss's.
  if (node.when && words.includes(node.when) && places.some((p) => p.startsWith("tool:") && node.at.some((a) => placeMatches(a, `tool_result:${p.slice(5)}`)))) return true;
  // Nothing goes wrong at a load itself: a skill or memory node's misses alone say which misses are its.
  if (atLoad(node.at)) return namesMiss(node.misses, words);
  if (!places.some((p) => node.at.some((a) => placeMatches(a, p)))) return false;
  if (node.at.some((a) => narrowFile(a) && places.some((p) => p.startsWith("file:") && placeMatches(a, p)))) return true;
  return namesMiss(node.misses, words);
}

/** Whether a place names one moment exactly: no `*` in it. */
export function exactPlace(place: string): boolean {
  return !!place && !place.includes("*");
}

export function relativePath(path: string, cwd?: string): string {
  const p = path.replace(/\\/g, "/");
  if (!cwd) return p;
  const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  const fold = (s: string) => (/^[a-z]:\//i.test(s) ? s.toLowerCase() : s);
  return fold(p).startsWith(fold(base)) ? p.slice(base.length) : p;
}

const PATH_KEYS = ["file_path", "path", "notebook_path"];

function filePlaces(input: Json | undefined, cwd?: string): Place[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return PATH_KEYS.flatMap((k) => (typeof input[k] === "string" && input[k] ? [`file:${relativePath(input[k] as string, cwd)}`] : []));
}

const obj = (v: Json | undefined): Record<string, Json> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : undefined;

export function isAsk(e: ExchangeEvent): boolean {
  if (e.kind === "refuse") return obj(e.detail)?.code === ASK;
  const out = e.kind === "act" ? obj(e.act?.output) : undefined;
  return !!out && typeof out.refused === "string" && out.code === ASK;
}

const short = (v: unknown, n = 300): string => {
  const s = typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

export interface Miss {
  seq: number;
  /** Where it stands: the act's place and its files, or the refusal's place. */
  places: Place[];
  /** Its words, cut to one line: the refusal, or what the failed act answered. */
  words: string;
  /** Its words whole, as coverage reads them. */
  text: string;
  /** What was being done, in one line. */
  doing?: string;
}

/** Every miss in a run, in seq order. */
export function missesOf(events: ExchangeEvent[], cwd?: string): Miss[] {
  const out: Miss[] = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (isAsk(e)) continue;
    if (e.kind === "refuse" && e.place) out.push({ seq: e.seq, places: [e.place], words: short(e.text), text: e.text ?? "" });
    else if (e.kind === "act" && e.act?.ok === false) {
      const o = obj(e.act.output);
      const words = typeof o?.text === "string" ? o.text : e.act.output;
      out.push({
        seq: e.seq,
        places: [...(e.place ? [e.place] : []), ...filePlaces(e.act.input, cwd)],
        words: short(words) || "it failed, without saying why",
        text: typeof words === "string" ? words : words === undefined || words === null ? "" : JSON.stringify(words),
        doing: short(e.act.input, 160),
      });
    }
  }
  return out;
}

/** Whether a node loaded now (other than `except`) covers the miss. */
export function covered(miss: Miss, nodes: (Pick<NodeInfo, "id" | "at"> & { misses?: string })[], except?: string): boolean {
  return nodes.some((n) => n.id !== except && covers(n, miss.places, miss.text));
}

/** The seqs an asking node already asked about in this run: `#<seq>` on its first line. */
export function askedIn(events: ExchangeEvent[], asker: string): Set<number> {
  const out = new Set<number>();
  for (const e of events) {
    if (e.kind !== "refuse" || e.node !== asker || !e.text) continue;
    for (const m of e.text.split("\n")[0]!.matchAll(/#(\d+)/g)) out.add(Number(m[1]));
  }
  return out;
}
