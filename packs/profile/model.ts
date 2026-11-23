/**
 * The profile pack's rules, pure: which profiles a run is in, which nodes a
 * profile holds, and whether a run hears a node. index.ts keeps the model
 * from the graph and wires it to the agent pack.
 *
 * Decided (20 Nov 2026, "How does a run find its profiles,
 * safely?", all five):
 * - Places link to profiles: a run is in a profile when one of its fact
 *   values is the id of an item linked to it by `uses` (a repo, a hub), or
 *   the profile's own id (the run said so). A `match` find-line over facts
 *   is an optional extra. `profiles_drop` takes a profile out.
 * - Fail open: a run in no profile hears every node.
 * - A profile in shadow holds nothing; it only records what it would.
 */
import type { Facts, NodeInfo } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import type { Hearing, ProfileInfo } from "../../spec/profile.ts";
import { placeMatches } from "../agent/index.ts";

export interface Profile {
  id: Id;
  title: string;
  /** `on`: holds nodes back. `shadow`: only records. `off`: as if it weren't there. */
  state: "on" | "shadow" | "off";
  /** A find-line over a run's facts: an optional extra way in. */
  match?: string;
  /** A find-line over nodes: what it holds besides its links. */
  members?: string;
  /** A run that no profile matches is in this one (the workspace's default). */
  fallback?: boolean;
  /** What it is part of. */
  parts: Id[];
  /** Items whose runs are in it (`uses`). */
  places: Id[];
  /** Items it holds (`in_umwelt`, and each such link with places) and takes out (`out_of_umwelt`). */
  holds: Id[];
  drops: Id[];
}

/** A find-line: words, and `key:value` terms. Same key: any of them; different keys: all. */
export interface Line {
  words: string[];
  terms: Map<string, string[]>;
}

export function parseLine(line: string | undefined): Line {
  const out: Line = { words: [], terms: new Map() };
  for (const tok of (line ?? "").trim().split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf(":");
    if (i <= 0) {
      out.words.push(tok.toLowerCase());
      continue;
    }
    const k = tok.slice(0, i).toLowerCase();
    out.terms.set(k, [...(out.terms.get(k) ?? []), tok.slice(i + 1)]);
  }
  return out;
}

const empty = (l: Line) => !l.words.length && !l.terms.size;

/** `*` any text; case doesn't count. */
function glob(pattern: string, value: string): boolean {
  const re = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}$`, "i").test(value);
}

const values = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** A match line over facts: each term's key is a fact, its value a glob over the fact's values. An empty line matches nothing. */
export function matchFacts(line: string | undefined, facts: Facts): boolean {
  const l = parseLine(line);
  if (empty(l) || l.words.length) return false;
  for (const [k, pats] of l.terms) {
    const have = values(facts[k]);
    if (!pats.some((p) => have.some((v) => glob(p, v)))) return false;
  }
  return true;
}

/**
 * A members line over a node: `at:<pattern>` (one of its places falls under
 * it: `at:file:packs/**`, `at:skill:rhino*`), `kind:`, `pack:`, `id:`, and
 * words in its title. An empty line holds nothing.
 */
export function matchNode(line: string | undefined, node: NodeInfo): boolean {
  const l = parseLine(line);
  if (empty(l)) return false;
  const title = node.title.toLowerCase();
  if (!l.words.every((w) => title.includes(w))) return false;
  for (const [k, pats] of l.terms) {
    const ok =
      k === "at"
        ? pats.some((p) => node.at.some((a) => placeMatches(p, a) || glob(p, a)))
        : k === "kind"
          ? pats.some((p) => glob(p, node.kind))
          : k === "pack"
            ? pats.some((p) => glob(p, node.pack))
            : k === "id"
              ? pats.some((p) => glob(p, node.id))
              : false;
    if (!ok) return false;
  }
  return true;
}

export interface Model {
  profiles: Map<Id, Profile>;
}

/** The profiles a run is in: those its facts put it in, then what each is part of. Off profiles and dropped ones aren't. */
export function runProfiles(model: Model, facts: Facts): (ProfileInfo & { state: Profile["state"] })[] {
  const said = new Set(Object.entries(facts).filter(([k]) => k !== "profiles_drop").flatMap(([, v]) => values(v)));
  const dropped = new Set(values(facts.profiles_drop));
  const live = (p: Profile | undefined): p is Profile => !!p && p.state !== "off" && !dropped.has(p.id);
  const out = new Map<Id, ProfileInfo & { state: Profile["state"] }>();
  for (const p of model.profiles.values()) {
    if (!live(p)) continue;
    if (said.has(p.id) || p.places.some((x) => said.has(x)) || matchFacts(p.match, facts)) {
      out.set(p.id, { id: p.id, title: p.title, by: "match", holding: p.state === "on", state: p.state });
    }
  }
  // A run nothing places is in the workspace's fallback profiles, if it has any; else in none (fail open).
  if (!out.size) {
    for (const p of model.profiles.values()) {
      if (live(p) && p.fallback) out.set(p.id, { id: p.id, title: p.title, by: "match", holding: p.state === "on", state: p.state });
    }
  }
  const queue = [...out.keys()];
  while (queue.length) {
    const p = model.profiles.get(queue.shift()!)!;
    for (const up of p.parts) {
      const q = model.profiles.get(up);
      if (!live(q) || out.has(q.id)) continue;
      out.set(q.id, { id: q.id, title: q.title, by: "part", holding: q.state === "on", state: q.state });
      queue.push(q.id);
    }
  }
  return [...out.values()];
}

/**
 * The facts that move a run into `target`: `profiles` names it, and
 * `profiles_drop` takes out every other profile the run matches now (its
 * earlier drops kept, the target's own let go). What `profile.place` gives
 * at begin, as the `run` tool's `profiles` and `drop` would.
 */
export function placing(model: Model, facts: Facts, target: Id): { profiles: Id[]; profiles_drop: Id[] } {
  const others = runProfiles(model, facts).filter((p) => p.by === "match" && p.id !== target).map((p) => p.id);
  const drops = new Set([...values(facts.profiles_drop), ...others]);
  drops.delete(target);
  return { profiles: [target], profiles_drop: [...drops] };
}

/** The profiles that hold a node (by link or by members) and those that take it out. Off profiles don't. */
export function nodeProfiles(model: Model, node: NodeInfo): { in: Profile[]; out: Profile[] } {
  const res = { in: [] as Profile[], out: [] as Profile[] };
  for (const p of model.profiles.values()) {
    if (p.state === "off") continue;
    if (node.source && p.drops.includes(node.source)) res.out.push(p);
    else if ((node.source && p.holds.includes(node.source)) || matchNode(p.members, node)) res.in.push(p);
  }
  return res;
}

const names = (ps: { title: string }[]) => ps.map((p) => p.title).join(", ");

/** Why a run would not hear a node, counting only the profiles `counts` lets in; nothing: it hears it. */
function why(run: (ProfileInfo & { state: Profile["state"] })[], node: { in: Profile[]; out: Profile[] }, counts: (s: Profile["state"]) => boolean): string | null {
  const runIn = run.filter((p) => counts(p.state));
  const nodeIn = node.in.filter((p) => counts(p.state));
  const taken = node.out.filter((p) => counts(p.state) && runIn.some((r) => r.id === p.id));
  if (taken.length) return `Taken out of ${names(taken)}.`;
  if (!nodeIn.length || !runIn.length) return null;
  if (nodeIn.some((p) => runIn.some((r) => r.id === p.id))) return null;
  return `For ${names(nodeIn)}; this run is in ${names(runIn)}.`;
}

/** Whether a run hears a node: held back only by profiles that hold; what shadows would hold back is said as `shadow`. */
export function hearing(model: Model, facts: Facts, node: NodeInfo): Hearing {
  const run = runProfiles(model, facts);
  const held = nodeProfiles(model, node);
  const now = why(run, held, (s) => s === "on");
  if (now) return { hears: false, why: now };
  const would = why(run, held, (s) => s !== "off");
  return would ? { hears: true, shadow: would } : { hears: true };
}
