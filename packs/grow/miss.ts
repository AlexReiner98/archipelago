/**
 * Misses nothing covers, apart from the runtime: a run's exchange events
 * and the nodes loaded now in, the misses no node listens at out.
 *
 * A miss is a refusal, or an act that didn't work (`ok: false`), as the
 * verdict pack reads them: an act stands at its place and at the files its
 * input names, made relative to the run's folder. A refusal with the code
 * `ask`, and the act it denies, are a question, not a miss. A miss is
 * covered when a node loaded now listens at one of its places; the asking
 * node itself doesn't count.
 *
 * Place matching follows spec/agent.md, written here (as in the verdict
 * pack) so this pack doesn't name another pack.
 */
import type { NodeInfo, Place } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";

/** The refusal code of a question to the agent (the verdict pack's ASK). */
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
  /** Its words: the refusal, or what the failed act answered. */
  words: string;
  /** What was being done, in one line. */
  doing?: string;
}

/** Every miss in a run, in seq order. */
export function missesOf(events: ExchangeEvent[], cwd?: string): Miss[] {
  const out: Miss[] = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (isAsk(e)) continue;
    if (e.kind === "refuse" && e.place) out.push({ seq: e.seq, places: [e.place], words: short(e.text) });
    else if (e.kind === "act" && e.act?.ok === false) {
      const o = obj(e.act.output);
      const words = typeof o?.text === "string" ? o.text : e.act.output;
      out.push({
        seq: e.seq,
        places: [...(e.place ? [e.place] : []), ...filePlaces(e.act.input, cwd)],
        words: short(words) || "it failed, without saying why",
        doing: short(e.act.input, 160),
      });
    }
  }
  return out;
}

/** Whether a node loaded now (other than `except`) listens at one of the miss's places. */
export function covered(miss: Miss, nodes: Pick<NodeInfo, "id" | "at">[], except?: string): boolean {
  return nodes.some((n) => n.id !== except && n.at.some((a) => miss.places.some((p) => placeMatches(a, p))));
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
