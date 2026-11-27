/**
 * Judging, apart from the runtime: a run's exchange events and the nodes'
 * places in, a digest of the run (what judging reads of it, `RunDigest`),
 * and from it a verdict per node said there, out; verdicts in, a record
 * per node out. Imports only types and the agent plugin's place matching.
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
 * with no such words isn't failed by every failed Bash call. The grow plugin
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
 * A person's decision on a run's reply (a `decision` act at `reply_end`: a
 * call's answer accepted or rejected) judges every node said before it, as
 * everything said in a one-request run was said to that reply: rejected is
 * a miss after each, accepted holds each. Only the last decision counts.
 *
 * Place matching follows spec/agent.md: the family must be the same, and in
 * the argument `*` stays within a path segment and `**` doesn't. It is
 * written here, not imported, so this plugin doesn't name the agent plugin.
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
  /**
   * A person's last decision in the run after it was said, where it
   * listens or on the reply (`decision` acts, spec/agent.md editions 3 and
   * 11): allow (or accept) and deny (or reject). The label its verdict is
   * checked against.
   */
  label?: "allow" | "deny";
  /** The recorded run this one replays, when it is a replay (plugins/replay): judged alike, kept apart. */
  replay_of?: RunId;
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

/** How much of a failed act's output a slim event keeps, as text: a miss's words. */
export const OUTPUT_KEPT = 4000;

/**
 * How much of a working act's output a slim event keeps: where a node's miss
 * phrase is looked for (a near miss, found in `take`). An error's words come
 * first in what a tool answers; 4,000 characters of every act that worked
 * filled a hosted map's 512 MB heap as its journal grew (27 Nov 2026).
 */
export const OUTPUT_KEPT_WORKED = 400;

/**
 * The first `n` characters as a string of their own. A slice in V8 can keep
 * the whole string it was cut from alive; a copy through a Buffer doesn't.
 */
function cut(s: string, n = OUTPUT_KEPT): string {
  return s.length <= n ? s : Buffer.from(s.slice(0, n), "utf8").toString("utf8");
}

/**
 * What judging reads of an event, and no more: an act keeps its kind, who
 * decided, whether it worked, the path fields of its input, and of its
 * output the refusal fields (`refused`, `code`, `text`) or its start as
 * text: OUTPUT_KEPT characters when it failed, OUTPUT_KEPT_WORKED when it
 * worked. Whole bodies (a screenshot, a file read) stay in the exchange's
 * journal; held whole for every run, they filled a map's heap.
 */
export function slimEvent(e: ExchangeEvent): ExchangeEvent {
  if (!e.act) return e;
  const { input, output, ...rest } = e.act;
  const keep = e.act.ok === false ? OUTPUT_KEPT : OUTPUT_KEPT_WORKED;
  const paths = input && typeof input === "object" && !Array.isArray(input) ? Object.fromEntries(PATH_KEYS.flatMap((k) => (typeof input[k] === "string" ? [[k, input[k]]] : []))) : undefined;
  let out: Json | undefined;
  if (output && typeof output === "object" && !Array.isArray(output) && (typeof output.refused === "string" || typeof output.code === "string" || typeof output.text === "string")) {
    out = Object.fromEntries(
      (["refused", "code", "text"] as const).flatMap((k) => (output[k] === undefined ? [] : [[k, typeof output[k] === "string" ? cut(output[k] as string, keep) : output[k]!]])),
    );
  } else if (output !== undefined && output !== null) {
    out = cut(text(output), keep);
  }
  return { ...e, act: { ...rest, ...(paths && Object.keys(paths).length ? { input: paths } : {}), ...(out !== undefined ? { output: out } : {}) } as ExchangeEvent["act"] };
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

/** Where a person's decision on a reply stands: what was said before it in the run was said to that reply. */
export const REPLY_AT = "reply_end";

/**
 * Whether the event is a person's decision on the run's reply (a call's
 * answer): accepted (`ok`) or rejected (`ok: false`), a `decision` act at
 * `reply_end`. Only a run's last one counts: a person may change their mind.
 */
export function isReplyDecision(e: ExchangeEvent): boolean {
  return e.kind === "act" && e.place === REPLY_AT && e.act?.kind === "decision" && e.act.by === "person";
}

/** Where a miss stands, or undefined when the event isn't one. `cwd` is the run's. */
export function missPlaces(e: ExchangeEvent, cwd?: string): Place[] | undefined {
  if (isAsk(e) || isReplyDecision(e)) return undefined;
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

/**
 * The recorded run a run replays, as its `begin` says (the fact
 * `replay_of`, which the scripted plugin's replay sets): its agent's side is
 * what happened then, the map's is today's.
 */
export function replayOf(events: ExchangeEvent[]): RunId | undefined {
  const d = events.find((e) => e.kind === "begin")?.detail;
  if (!d || typeof d !== "object" || Array.isArray(d)) return undefined;
  const f = d.facts;
  const v = f && typeof f === "object" && !Array.isArray(f) ? f.replay_of : undefined;
  return typeof v === "string" && v ? v : undefined;
}

/** The run's folder, as its `begin` says. */
export function cwdOf(events: ExchangeEvent[]): string | undefined {
  const d = events.find((e) => e.kind === "begin")?.detail;
  if (!d || typeof d !== "object" || Array.isArray(d)) return undefined;
  return typeof d.cwd === "string" && d.cwd ? d.cwd : undefined;
}


const isSaying = (e: ExchangeEvent) => (e.kind === "say" || e.kind === "refuse") && !!e.node;

/** Whether the event is a person's decision (allow or deny a tool call, accept or reject a reply). */
const isDecision = (e: ExchangeEvent) => e.kind === "act" && e.act?.kind === "decision" && e.act.by === "person";

/** The phrases of a node's `misses` long enough to stand for that miss alone: its comma- or line-separated parts of 16 characters or more. */
export function missPhrases(misses: string | undefined): string[] {
  return (misses ?? "")
    .split(/[,;\n]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= 16);
}

// ---------- a run's digest: what judging reads of it, and no more ----------

/** One node's sayings (and refusals) in a run, added up. */
export interface Sayings {
  /** The seq and time of its first saying. */
  first: number;
  said_at: Time;
  said: number;
  refused: boolean;
  /** How many times at each place, in the order first said there. */
  places: Map<Place, number>;
  /** Its last saying's time. */
  last: Time;
}

/** Something that went wrong in a run (a refusal, a failed act), as covering reads it. */
interface Miss {
  seq: number;
  place?: Place;
  /** The paths its input names, as given (made places with the run's cwd when judged). */
  paths?: string[];
  /** The node that refused, or the one whose refusal denied this act. */
  node?: string;
  denied?: string;
  /**
   * Its words (`wordsOf`), each once, space-separated: all `namesMiss` reads
   * of them. A listener's `when` (a substring of the raw words) isn't looked
   * for here: `listeningOf` gives none.
   */
  words: string;
}

/** A person's decision: a label where it stands, and on the reply what judges every node said before. */
interface Decision {
  seq: number;
  place?: Place;
  paths?: string[];
  ok: boolean;
}

/**
 * What judging needs of one run, gathered as its events come in seq
 * order: the run's cwd and what it replays, each node's sayings added up,
 * its misses with their words, people's decisions, and where acts that
 * worked stood. An act that worked keeps no output: its near misses for
 * the nodes said before it are found as it comes in (`near`), with the
 * nodes' places and phrases then. When a node's place or phrases change,
 * the runs it was said in where an act worked at its places are read
 * again from the exchange (plugins/verdict, `nearAgain`).
 */
export interface RunDigest {
  run: RunId;
  /** The highest seq taken: events come in seq order, so one seen again is skipped. */
  last: number;
  /** Whether its first `begin` came: cwd and replay_of are that one's. */
  begun: boolean;
  cwd?: string;
  replay_of?: RunId;
  /** Per node said in it, in the order first said. */
  said: Map<string, Sayings>;
  misses: Miss[];
  decisions: Decision[];
  /** Where acts that worked stood, and the paths they named: whether a node may have near misses here. */
  worked: Set<Place>;
  workedPaths: Set<string>;
  /** Per node, the seqs of its near misses (an act that worked, after it was said, holding one of its phrases). */
  near: Map<string, number[]>;
  /** An act naming a path came before the first `begin`: its near misses were looked for without the run's cwd. */
  lateBegin: boolean;
}

/** Keeps each string once, however many events repeat it. */
export type Intern = (s: string) => string;
const same: Intern = (s) => s;

export function newDigest(run: RunId, begin?: { cwd?: string; replay_of?: RunId }): RunDigest {
  return {
    run,
    last: 0,
    begun: !!begin,
    ...(begin?.cwd ? { cwd: begin.cwd } : {}),
    ...(begin?.replay_of ? { replay_of: begin.replay_of } : {}),
    said: new Map(),
    misses: [],
    decisions: [],
    worked: new Set(),
    workedPaths: new Set(),
    near: new Map(),
    lateBegin: false,
  };
}

/** The paths an act's input names, as given. */
function pathsOf(input: Json | undefined, intern: Intern): string[] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const k of PATH_KEYS) {
    const v = input[k];
    if (typeof v === "string" && v) out.push(intern(v));
  }
  return out.length ? out : undefined;
}

const placesOf = (place: Place | undefined, paths: string[] | undefined, cwd?: string): Place[] => [
  ...(place ? [place] : []),
  ...(paths ?? []).map((p) => `file:${relativePath(p, cwd)}`),
];

/** A text's words, each once, as one string of their own. */
const digestWords = (text: string) => [...wordsOf(text)].join(" ");

const phrasesOf = new WeakMap<Listener, string[]>();
function phrases(listener: Listener): string[] {
  let p = phrasesOf.get(listener);
  if (!p) phrasesOf.set(listener, (p = missPhrases(listener.misses)));
  return p;
}

/**
 * Takes an event into its run's digest, the run's events in seq order
 * (one seen before is skipped: false). Near misses are looked for with
 * `listening` as it is now.
 */
export function take(d: RunDigest, e: ExchangeEvent, listening: Listening, intern: Intern = same): boolean {
  if (e.run !== d.run || e.seq <= d.last) return false;
  d.last = e.seq;
  if (e.kind === "begin" && !d.begun) {
    d.begun = true;
    const cwd = cwdOf([e]);
    const of = replayOf([e]);
    if (cwd) d.cwd = cwd;
    if (of) d.replay_of = of;
    if (d.workedPaths.size) d.lateBegin = true;
    return true;
  }
  if (isSaying(e)) {
    const node = intern(e.node!);
    let s = d.said.get(node);
    if (!s) d.said.set(node, (s = { first: e.seq, said_at: e.time, said: 0, refused: false, places: new Map(), last: e.time }));
    s.said++;
    if (e.kind === "refuse") s.refused = true;
    if (e.place) s.places.set(intern(e.place), (s.places.get(e.place) ?? 0) + 1);
    if (e.time > s.last) s.last = e.time;
  }
  const slim = e.act ? slimEvent(e) : e;
  const place = e.place ? intern(e.place) : undefined;
  const paths = e.kind === "act" ? pathsOf(slim.act?.input, intern) : undefined;
  if (missPlaces(slim) !== undefined) {
    const node = e.node ? intern(e.node) : undefined;
    const denied = deniedBy(slim);
    d.misses.push({
      seq: e.seq,
      ...(place ? { place } : {}),
      ...(paths ? { paths } : {}),
      ...(node ? { node } : {}),
      ...(denied ? { denied: intern(denied) } : {}),
      words: digestWords(missWords(slim)),
    });
  }
  if (isDecision(e)) d.decisions.push({ seq: e.seq, ...(place ? { place } : {}), ...(paths ? { paths } : {}), ok: e.act!.ok !== false });
  if (e.kind === "act" && e.act && e.act.ok !== false) {
    if (place) d.worked.add(place);
    for (const p of paths ?? []) d.workedPaths.add(p);
    const denied = deniedBy(slim);
    let out: string | undefined;
    let places: Place[] | undefined;
    for (const [node, s] of d.said) {
      if (s.first >= e.seq || denied === node) continue;
      const listener = listening.get(node);
      const want = listener ? phrases(listener) : [];
      if (!want.length) continue;
      places ??= placesOf(place, paths, d.cwd);
      if (!places.some((p) => listener!.at.some((a) => placeMatches(a, p)))) continue;
      out ??= text(slim.act!.output).toLowerCase();
      if (!want.some((p) => out!.includes(p))) continue;
      const list = d.near.get(node) ?? [];
      list.push(e.seq);
      d.near.set(node, list);
    }
  }
  return true;
}

/** Whether an act that worked in the run stood where the listener listens: whether it may have near misses there. */
export function mayBeNear(d: RunDigest, listener: Listener): boolean {
  if (!phrases(listener).length) return false;
  const at = (p: Place) => listener.at.some((a) => placeMatches(a, p));
  for (const p of d.worked) if (at(p)) return true;
  for (const p of d.workedPaths) if (at(`file:${relativePath(p, d.cwd)}`)) return true;
  return false;
}

/** A run's digest from its events, in any order. */
export function digestOf(run: RunId, events: ExchangeEvent[], listening: Listening, intern: Intern = same): RunDigest {
  const sorted = events.filter((e) => e.run === run).sort((a, b) => a.seq - b.seq);
  const begin = sorted.find((e) => e.kind === "begin");
  const d = newDigest(run, begin ? { cwd: cwdOf([begin]), replay_of: replayOf([begin]) } : undefined);
  for (const e of sorted) take(d, e, listening, intern);
  return d;
}

/** One run's verdicts from its digest, one per node said in it, in the order each was first said. */
export function judgeDigest(d: RunDigest, listening: Listening): RunVerdict[] {
  const misses = d.misses.map((m) => ({ ...m, places: placesOf(m.place, m.paths, d.cwd) }));
  const decisions = d.decisions.map((x) => ({ ...x, places: placesOf(x.place, x.paths, d.cwd) }));
  // A person's last decision on the run's reply judges every node said before it.
  const decided = decisions.filter((x) => x.place === REPLY_AT).pop();
  const out: RunVerdict[] = [];
  for (const [node, s] of d.said) {
    const listener = listening.get(node) ?? { at: [...s.places.keys()] };
    const failedBy = misses.filter((m) => m.node !== node && m.denied !== node && covers(listener, m.places, m.words)).map((m) => m.seq);
    if (decided && !decided.ok && decided.seq > s.first) failedBy.push(decided.seq);
    failedBy.sort((a, b) => a - b);
    // Accepted after it was said: the reply it was said to was right.
    const accepted = !!decided && decided.ok && decided.seq > s.first;
    const before = failedBy.filter((seq) => seq < s.first).length;
    const afterList = failedBy.filter((seq) => seq > s.first);
    const near = (d.near.get(node) ?? []).filter((seq) => seq > s.first).length;
    const labelled = decisions
      .filter((x) => x.seq > s.first && (x.place === REPLY_AT || x.places.some((p) => listener.at.some((a) => placeMatches(a, p)))))
      .pop();
    out.push({
      run: d.run,
      node,
      verdict: afterList.length ? "failed" : before || s.refused || near || accepted ? "held" : "quiet",
      said: s.said,
      first: s.first,
      said_at: s.said_at,
      before,
      after: afterList.length,
      failed_by: afterList,
      near,
      ...(labelled ? { label: labelled.ok ? ("allow" as const) : ("deny" as const) } : {}),
      ...(d.replay_of ? { replay_of: d.replay_of } : {}),
    });
  }
  return out;
}

/** One run's verdicts, one per node said in it, in the order each was first said. */
export function judgeRun(run: RunId, events: ExchangeEvent[], listening: Listening): RunVerdict[] {
  return judgeDigest(digestOf(run, events, listening), listening);
}

/** Each node's record from runs' verdicts and their nodes' sayings. */
export function tally(runs: { verdicts: RunVerdict[]; said: Map<string, Sayings> }[]): NodeRecord[] {
  const by = new Map<string, NodeRecord>();
  const get = (node: string) => {
    let r = by.get(node);
    if (!r) by.set(node, (r = { node, said: 0, runs: 0, held: 0, failed: 0, quiet: 0, places: {} }));
    return r;
  };
  for (const { verdicts, said } of runs) {
    for (const v of verdicts) {
      const r = get(v.node);
      r.runs++;
      r[v.verdict]++;
    }
    for (const [node, s] of said) {
      const r = get(node);
      r.said += s.said;
      for (const [p, n] of s.places) r.places[p] = (r.places[p] ?? 0) + n;
      if (!r.last || s.last > r.last) r.last = s.last;
    }
  }
  return [...by.values()];
}

/** Each node's record from runs' verdicts and the sayings behind them. */
export function records(runs: { verdicts: RunVerdict[]; events: ExchangeEvent[] }[]): NodeRecord[] {
  return tally(runs.map(({ verdicts, events }) => ({ verdicts, said: digestOf(events[0]?.run ?? "", events, new Map()).said })));
}
