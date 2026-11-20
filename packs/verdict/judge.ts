/**
 * Judging, apart from the runtime: a run's exchange events and the nodes'
 * places in, a verdict per node said there out; verdicts in, a record per
 * node out. Imports only types and the agent pack's place matching.
 *
 * Per run, a node is judged from the first time it was said there (the
 * reflex record's meanings, 19 Nov 2026):
 * - failed: one of its misses came after;
 * - held: a miss came before and none after, or it refused something and
 *   nothing went wrong after (a refusal is the node working), or its miss's
 *   situation came up again after it was said and worked (`near`);
 * - quiet: no miss, no refusal and no near miss, nothing to judge.
 *
 * A node's miss is something going wrong that it covers: a refusal by
 * another node, or an act that didn't work (`ok: false`), at a place that
 * matches one of the node's `at`, where the node would plausibly have
 * prevented it (`covers`): it listens there as narrowly as the miss allows
 * (a file: pattern matching the miss's file), or its `misses` (the words of
 * the miss it should prevent) name the miss's words. A node at tool:Bash
 * with no such words isn't failed by every failed Bash call. The grow pack
 * decides coverage the same way. An act also stands at the files its input
 * names (`file:<path>`), so a node said for a file is judged by a failed
 * edit of that file. Claude Code names files by absolute path, so a path is
 * made relative to the run's cwd (from its `begin`) before it is a place.
 * The node's own refusals are its saying, not its miss, and neither is the
 * denied call a refusal causes (an act whose output names it as `refused`).
 * An exchange `miss` (a node threw) is a fault of the exchange, not the
 * agent's, and judges nothing. Nor does a refusal with the code `ask` (ASK):
 * it holds the agent back to ask it something, not because anything went
 * wrong, and neither does the act it denies.
 *
 * Place matching follows spec/agent.md: the family must be the same, and in
 * the argument `*` stays within a path segment and `**` doesn't. It is
 * written here, not imported, so this pack doesn't name the agent pack.
 */
import type { NodeInfo, Place, RunId } from "../../spec/agent.ts";
import type { Json, Time } from "../../spec/common.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";

function familyOf(place: string): string {
  const i = place.indexOf(":");
  return i < 0 ? place : place.slice(0, i + 1);
}

/** Whether a node's `at` pattern matches a concrete place. */
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

export type Verdict = "held" | "failed" | "quiet";

/** How one run went for one node. */
export interface RunVerdict {
  run: RunId;
  node: string;
  verdict: Verdict;
  /** How many times it was said (or refused) in the run. */
  said: number;
  /** The seq and time of its first saying there. */
  first: number;
  said_at: Time;
  /** Its misses in the run before its first saying, and after. */
  before: number;
  after: number;
  /** The seqs of the misses after: what failed it. */
  failed_by: number[];
  /**
   * Near misses after it was said: an act at its place that worked, whose
   * answer holds one of its miss's phrases word for word (`missPhrases`).
   * The situation came up again, and this time nothing went wrong.
   */
  near: number;
}

/** A node's record across runs. */
export interface NodeRecord {
  node: string;
  said: number;
  runs: number;
  held: number;
  failed: number;
  quiet: number;
  /** When it was last said. */
  last?: Time;
  /** How many times it was said at each place. */
  places: Record<string, number>;
}

/** Where each node listens and what it should prevent. A node no longer loaded is judged at the places it was said. */
export type Listening = Map<string, Listener>;

export function listeningOf(nodes: (Pick<NodeInfo, "id" | "at"> & { misses?: string })[]): Listening {
  return new Map(nodes.map((n) => [n.id, { at: n.at, ...(n.misses ? { misses: n.misses } : {}) }]));
}

const PATH_KEYS = ["file_path", "path", "notebook_path"];

/**
 * A path as a place argument: `/` for separators, and relative to `cwd` when
 * it lies inside it. A drive letter's case is folded, as Windows does.
 */
export function relativePath(path: string, cwd?: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const p = norm(path);
  if (!cwd) return p;
  const base = norm(cwd).replace(/\/+$/, "") + "/";
  const fold = (s: string) => (/^[a-z]:\//i.test(s) ? s.toLowerCase() : s);
  return fold(p).startsWith(fold(base)) ? p.slice(base.length) : p;
}

/** The files an act's input names, as places. */
function filePlaces(input: Json | undefined, cwd?: string): Place[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const out: Place[] = [];
  for (const k of PATH_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v) out.push(`file:${relativePath(v, cwd)}`);
  }
  return out;
}

/** The refusal code of a node that asks the agent something: not a miss. */
export const ASK = "ask";

/** Whether the event is an asking refusal, or the act one denied. */
export function isAsk(e: ExchangeEvent): boolean {
  if (e.kind === "refuse") {
    const d = e.detail;
    return !!d && typeof d === "object" && !Array.isArray(d) && d.code === ASK;
  }
  const out = e.kind === "act" ? e.act?.output : undefined;
  return !!out && typeof out === "object" && !Array.isArray(out) && typeof out.refused === "string" && out.code === ASK;
}

/** Where a miss stands, or undefined when the event isn't one. `cwd` is the run's. */
export function missPlaces(e: ExchangeEvent, cwd?: string): Place[] | undefined {
  if (isAsk(e)) return undefined;
  if (e.kind === "refuse" && e.place) return [e.place];
  if (e.kind === "act" && e.act?.ok === false) return [...(e.place ? [e.place] : []), ...filePlaces(e.act.input, cwd)];
  return undefined;
}

const text = (v: Json | undefined): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));

/** A miss's words: the refusal's, or what the failed act answered. */
export function missWords(e: ExchangeEvent): string {
  if (e.kind === "refuse") return e.text ?? "";
  const out = e.act?.output;
  if (out && typeof out === "object" && !Array.isArray(out) && typeof out.text === "string") return out.text;
  return text(out);
}

/** The node whose refusal denied this act, when it was a denied call. */
function deniedBy(e: ExchangeEvent): string | undefined {
  const out = e.kind === "act" ? e.act?.output : undefined;
  if (!out || typeof out !== "object" || Array.isArray(out)) return undefined;
  return typeof out.refused === "string" ? out.refused : undefined;
}

/** The run's folder, as its `begin` says. */
export function cwdOf(events: ExchangeEvent[]): string | undefined {
  const d = events.find((e) => e.kind === "begin")?.detail;
  if (!d || typeof d !== "object" || Array.isArray(d)) return undefined;
  return typeof d.cwd === "string" && d.cwd ? d.cwd : undefined;
}

const isSaying = (e: ExchangeEvent) => (e.kind === "say" || e.kind === "refuse") && !!e.node;

/** Whether a miss event is one of this node's: one it covers, and not its own. */
function isMissOf(e: ExchangeEvent, node: string, listener: Listener, cwd?: string): boolean {
  if (e.node === node || deniedBy(e) === node) return false;
  const places = missPlaces(e, cwd);
  if (!places) return false;
  return covers(listener, places, missWords(e));
}

/** The phrases of a node's `misses` long enough to stand for that miss alone: its comma- or line-separated parts of 16 characters or more. */
export function missPhrases(misses: string | undefined): string[] {
  return (misses ?? "")
    .split(/[,;\n]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= 16);
}

/**
 * Whether an act that worked stands where the node listens and answered
 * with one of its miss's phrases, word for word: the situation came up
 * again and went right. Its input doesn't count (a search for the error
 * names it), nor a few words in common (any JSON output has "json").
 */
function isNearOf(e: ExchangeEvent, node: string, listener: Listener, cwd?: string): boolean {
  if (e.kind !== "act" || !e.act || e.act.ok === false || deniedBy(e) === node) return false;
  const phrases = missPhrases(listener.misses);
  if (!phrases.length) return false;
  const places = [...(e.place ? [e.place] : []), ...filePlaces(e.act.input, cwd)];
  if (!places.some((p) => listener.at.some((a) => placeMatches(a, p)))) return false;
  const out = text(e.act.output).toLowerCase();
  return phrases.some((p) => out.includes(p));
}

/** One run's verdicts, one per node said in it, in the order each was first said. */
export function judgeRun(run: RunId, events: ExchangeEvent[], listening: Listening): RunVerdict[] {
  const sorted = [...events].filter((e) => e.run === run).sort((a, b) => a.seq - b.seq);
  const cwd = cwdOf(sorted);
  const sayings = new Map<string, ExchangeEvent[]>();
  for (const e of sorted) {
    if (!isSaying(e)) continue;
    const list = sayings.get(e.node!) ?? [];
    list.push(e);
    sayings.set(e.node!, list);
  }
  const out: RunVerdict[] = [];
  for (const [node, said] of sayings) {
    const first = said[0]!;
    const listener = listening.get(node) ?? { at: [...new Set(said.map((s) => s.place).filter((p): p is Place => !!p))] };
    const misses = sorted.filter((e) => isMissOf(e, node, listener, cwd));
    const refused = said.some((s) => s.kind === "refuse");
    const before = misses.filter((m) => m.seq < first.seq).length;
    const afterList = misses.filter((m) => m.seq > first.seq);
    const after = afterList.length;
    const near = sorted.filter((e) => e.seq > first.seq && isNearOf(e, node, listener, cwd)).length;
    out.push({
      run,
      node,
      verdict: after ? "failed" : before || refused || near ? "held" : "quiet",
      said: said.length,
      first: first.seq,
      said_at: first.time,
      before,
      after,
      failed_by: afterList.map((m) => m.seq),
      near,
    });
  }
  return out;
}

/** Each node's record from runs' verdicts and the sayings behind them. */
export function records(runs: { verdicts: RunVerdict[]; events: ExchangeEvent[] }[]): NodeRecord[] {
  const by = new Map<string, NodeRecord>();
  const get = (node: string) => {
    let r = by.get(node);
    if (!r) by.set(node, (r = { node, said: 0, runs: 0, held: 0, failed: 0, quiet: 0, places: {} }));
    return r;
  };
  for (const { verdicts, events } of runs) {
    for (const v of verdicts) {
      const r = get(v.node);
      r.runs++;
      r[v.verdict]++;
    }
    for (const e of events) {
      if (!isSaying(e)) continue;
      const r = get(e.node!);
      r.said++;
      if (e.place) r.places[e.place] = (r.places[e.place] ?? 0) + 1;
      if (!r.last || e.time > r.last) r.last = e.time;
    }
  }
  return [...by.values()];
}
