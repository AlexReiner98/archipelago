/**
 * Judging, apart from the runtime: a run's exchange events and the nodes'
 * places in, a verdict per node said there out; verdicts in, a record per
 * node out. Imports only types and the agent pack's place matching.
 *
 * Per run, a node is judged from the first time it was said there (the
 * reflex record's meanings, 19 Nov 2026):
 * - failed: one of its misses came after;
 * - held: a miss came before and none after, or it refused something and
 *   nothing went wrong after (a refusal is the node working);
 * - quiet: no miss and no refusal, nothing to judge.
 *
 * A node's miss is something going wrong where it listens: a refusal by
 * another node, or an act that didn't work (`ok: false`), at a place that
 * matches one of the node's `at`. An act also stands at the files its input
 * names (`file:<path>`), so a node said for a file is judged by a failed
 * edit of that file. Claude Code names files by absolute path, so a path is
 * made relative to the run's cwd (from its `begin`) before it is a place.
 * The node's own refusals are its saying, not its miss, and neither is the
 * denied call a refusal causes (an act whose output names it as `refused`).
 * An exchange `miss` (a node threw) is a fault of the exchange, not the
 * agent's, and judges nothing.
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

/** Where a node listens. A node no longer loaded is judged at the places it was said. */
export type Listening = Map<string, Place[]>;

export function listeningOf(nodes: Pick<NodeInfo, "id" | "at">[]): Listening {
  return new Map(nodes.map((n) => [n.id, n.at]));
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

/** Where a miss stands, or undefined when the event isn't one. `cwd` is the run's. */
export function missPlaces(e: ExchangeEvent, cwd?: string): Place[] | undefined {
  if (e.kind === "refuse" && e.place) return [e.place];
  if (e.kind === "act" && e.act?.ok === false) return [...(e.place ? [e.place] : []), ...filePlaces(e.act.input, cwd)];
  return undefined;
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

/** Whether a miss event is one of this node's: at a place it listens at, and not its own. */
function isMissOf(e: ExchangeEvent, node: string, at: Place[], cwd?: string): boolean {
  if (e.node === node || deniedBy(e) === node) return false;
  const places = missPlaces(e, cwd);
  if (!places) return false;
  return places.some((p) => at.some((a) => placeMatches(a, p)));
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
    const at = listening.get(node) ?? [...new Set(said.map((s) => s.place).filter((p): p is Place => !!p))];
    const misses = sorted.filter((e) => isMissOf(e, node, at, cwd));
    const refused = said.some((s) => s.kind === "refuse");
    const before = misses.filter((m) => m.seq < first.seq).length;
    const afterList = misses.filter((m) => m.seq > first.seq);
    const after = afterList.length;
    out.push({
      run,
      node,
      verdict: after ? "failed" : before || refused ? "held" : "quiet",
      said: said.length,
      first: first.seq,
      said_at: first.time,
      before,
      after,
      failed_by: afterList.map((m) => m.seq),
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
