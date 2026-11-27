/**
 * One sync run between two maps (README). Each map is an `End`: something
 * that calls its served keys, as the bridge's `POST /call` does, so a run
 * goes between two servers (`httpEnd`) or two runtimes in a test alike.
 *
 * The log is the truth, so a run reads each map's journal (`history.since`),
 * never its tables' last thousand sets:
 *
 *   status of both ──▶ each one's log since the other last had it
 *     first run ──▶ join: both logs replayed, items paired by id or by
 *                   type and title, the kept side's fields where they differ
 *     after     ──▶ plugins' new items paired or copied; everyone else's
 *                   sets, ids swapped through the pairs ──▶ plan (merge.ts)
 *   ──▶ writes applied on the other map (sync.apply) ──▶ cursors and pairs kept
 *
 * Reads are pages of at most LIMIT_MAX.
 */
import type { Outcome } from "../../spec/action.ts";
import type { Actor, Authority, Id, Json } from "../../spec/common.ts";
import type { Committed } from "../../spec/changeset.ts";
import type { Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import { actorOf, type Peer } from "./index.ts";
import {
  birthsOf,
  join,
  noPairs,
  ownWork,
  plan,
  replay,
  swapSet,
  swapValue,
  swapWrite,
  type Conflict,
  type Fields,
  type Pairs,
  type Planned,
  type Side,
  type Write,
} from "./merge.ts";

export interface End {
  /** Calls a key's method; `as` names the agent it acts as. */
  call<T>(key: string, method: string, args: unknown[], as?: Actor): Promise<T>;
}

interface Status {
  id: string;
  name: string;
  peers: Peer[];
}

export interface Report {
  a: { id: string; name: string; read: number; sent: number; facts: number };
  b: { id: string; name: string; read: number; sent: number; facts: number };
  /** The first run: the two maps made one. */
  joined?: { same: number; differed: number; kept: Side; copied: { toA: number; toB: number }; ambiguous: number };
  /** Items a map's own plugins made: paired with the other map's own, or copied where it has none. */
  plugins?: { paired: number; copied: number };
  /** What both changed, with the item's title, and which side's change stayed. */
  conflicts: (Conflict & { title?: string })[];
  /** Sets the other map refused (its schema holds them): which, and why. */
  refused: { to: Side; set: string; code: string; message: string }[];
  dry: boolean;
}

const RUN: Authority = { of: "agent", basis: "npm run map -- sync" };

const invoke = async <T extends Json = Json>(end: End, action: string, input: Json, reason: string, authority: Authority, as?: Actor): Promise<Outcome<T>> =>
  end.call<Outcome<T>>("action.invoke", "invoke", [{ action, input, reason, authority }], as);

const output = async <T,>(end: End, action: string, input: Json = {}): Promise<T> => {
  const r = await invoke(end, action, input, `sync: ${action}`, RUN);
  if (!r.ok) throw new Error(`${action}: ${r.refused.message}`);
  return r.output as unknown as T;
};

interface Log {
  /** Every set read, in order. */
  all: Committed[];
  /** Of those, the ones to send: not a sync's copy from the peer, not a plugin's own work. */
  sets: Committed[];
  /** The plugins' own sets. */
  own: Committed[];
  read: number;
  cursor?: string;
}

/** A map's log after `cursor`, from its journal; refused where the log has a hole or doesn't reach back to the start. */
async function logOf(end: End, name: string, peer: string, cursor?: string): Promise<Log> {
  const log: Log = { all: [], sets: [], own: [], read: 0 };
  let after = cursor;
  for (;;) {
    const page = await output<{ items: Committed[]; next?: string; begins?: number }>(end, "history.since", { limit: LIMIT_MAX, ...(after ? { after } : {}) });
    if (!log.read && page.items.length) {
      const first = page.items[0]!.seq, want = after ? Number(after) + 1 : 1;
      if (first > want) {
        throw new Error(
          after
            ? `${name}'s log jumps from ${after} to ${first}: what came between was folded or lost, so it can't be sent`
            : `${name}'s log begins at ${first}, not at its first change: run history.verify there, and give it a log from the start before a first sync`,
        );
      }
    }
    for (const c of page.items) {
      log.read++;
      log.all.push(c);
      after = String(c.seq);
      if (c.header.action === "sync.apply" && c.header.actor.id === actorOf(peer).id) continue;
      (ownWork(c) ? log.own : log.sets).push(c);
    }
    if (!page.next || !page.items.length) break;
  }
  // An empty log still marks that the two have met: its cursor is 0.
  log.cursor = after ?? "0";
  return log;
}

/** The ids a map has paired with a peer's, every page. */
async function pairsOf(end: End, peer: string): Promise<[Id, Id][]> {
  const out: [Id, Id][] = [];
  let after: string | undefined;
  do {
    const page = await output<{ items: [Id, Id][]; next?: string }>(end, "sync.pairs", { peer, limit: LIMIT_MAX, ...(after ? { after } : {}) });
    out.push(...page.items);
    after = page.next;
  } while (after);
  return out;
}

/** Items by id, every field with `type`, LIMIT_MAX at a time. */
async function itemsOf(end: End, ids: Id[]): Promise<Map<Id, Fields | null>> {
  const out = new Map<Id, Fields | null>();
  for (let i = 0; i < ids.length; i += LIMIT_MAX) {
    const batch = ids.slice(i, i + LIMIT_MAX);
    const items = await end.call<(Item | null)[]>("graph.read", "get", [batch]);
    batch.forEach((id, k) => out.set(id, items[k] ? { type: items[k]!.type, ...items[k]!.fields } : null));
  }
  return out;
}

/** An item of a type with a title, on a map, if exactly one has it: paging the type. */
async function titled(end: End, type: string, title: string): Promise<Id | undefined> {
  const found: Id[] = [];
  let after: string | undefined;
  do {
    const page = await end.call<{ items: Item[]; next?: string }>("graph.read", "of", [type, { limit: LIMIT_MAX, ...(after ? { after } : {}) }]);
    for (const it of page.items) if (it.fields.title === title) found.push(it.id);
    after = page.next;
  } while (after && found.length < 2);
  return found.length === 1 ? found[0] : undefined;
}

/** Writes in chunks a call can take, items before links (a link's ends must be there first). */
function chunks(writes: Write[]): Write[][] {
  const isLink = (w: Write) => "whole" in w && w.whole !== true && typeof w.whole.from === "string";
  const ordered = [...writes.filter((w) => !isLink(w)), ...writes.filter(isLink)];
  const out: Write[][] = [];
  for (let i = 0; i < ordered.length; i += LIMIT_MAX) out.push(ordered.slice(i, i + LIMIT_MAX));
  return out;
}

/**
 * Syncs `a` and `b`: each gets what the other changed since they last
 * synced, the later change winning field by field. The first run joins
 * them, `keep`'s fields (default `a`, the map it is run from) staying where
 * a pair differs. `dry` plans and reports without writing or moving the
 * cursors.
 */
export async function syncMaps(a: End, b: End, opts: { dry?: boolean; keep?: Side } = {}): Promise<Report> {
  const [sa, sb] = await Promise.all([output<Status>(a, "sync.status"), output<Status>(b, "sync.status")]);
  if (sa.id === sb.id) throw new Error(`both ends are map ${sa.name} (${sa.id})`);
  const ca = sa.peers.find((p) => p.id === sb.id)?.cursor;
  const cb = sb.peers.find((p) => p.id === sa.id)?.cursor;
  const [la, lb] = await Promise.all([logOf(a, sa.name, sb.id, ca), logOf(b, sb.name, sa.id, cb)]);
  const pairs: Pairs = noPairs();
  const known = (x: Id, y: Id) => (pairs.ab.set(x, y), pairs.ba.set(y, x));
  for (const [x, y] of await pairsOf(a, sb.id)) known(x, y);
  for (const [y, x] of await pairsOf(b, sa.id)) known(x, y);
  const fresh: [Id, Id][] = [];

  const report: Report = {
    a: { id: sa.id, name: sa.name, read: la.read, sent: 0, facts: 0 },
    b: { id: sb.id, name: sb.name, read: lb.read, sent: 0, facts: 0 },
    conflicts: [],
    refused: [],
    dry: !!opts.dry,
  };
  const apply = async (to: End, side: Side, writes: Write[], reason: string, authority: Authority, from: Status, set: string) => {
    for (const chunk of chunks(writes)) {
      if (!chunk.length) continue;
      const r = await invoke<{ facts: number }>(to, "sync.apply", { writes: chunk as unknown as Json }, reason, authority, actorOf(from.id));
      const mine = side === "a" ? report.b : report.a;
      if (r.ok) {
        mine.sent++;
        mine.facts += (r.output as { facts: number }).facts;
      } else report.refused.push({ to: side, set, code: r.refused.code, message: r.refused.message });
    }
  };

  if (!ca && !cb) {
    // The first run: both logs replayed whole, made one.
    const keep = opts.keep ?? "a";
    const j = join(replay(la.all), replay(lb.all), keep);
    for (const p of j.pairs) known(p[0], p[1]), fresh.push(p);
    report.joined = { same: j.same, differed: j.differed, kept: keep, copied: j.copied, ambiguous: j.ambiguous };
    if (!opts.dry) {
      const kept = keep === "a" ? sa.name : sb.name;
      await apply(a, "a", j.toA, `Joined with ${sb.name}: the first sync, ${kept}'s kept where they differed`, RUN, sb, "join");
      await apply(b, "b", j.toB, `Joined with ${sa.name}: the first sync, ${kept}'s kept where they differed`, RUN, sa, "join");
    }
  } else {
    // Items a plugin made since: paired with the other map's own of the same type and title, or copied.
    const born = async (log: Log, other: End, otherLog: Log, mine: Map<Id, Id>, side: Side): Promise<Planned[]> => {
      const copies: Planned[] = [];
      const theirs = new Map(otherLog.own.flatMap((s) => birthsOf(s)).map((x) => [`${x.type}\u0000${x.title}`, x.id]));
      for (const set of log.own) {
        const writes: Write[] = [];
        for (const x of birthsOf(set)) {
          if (mine.has(x.id)) continue;
          const match = x.title ? (theirs.get(`${x.type}\u0000${x.title}`) ?? (await titled(other, x.type, x.title))) : undefined;
          if (match && match !== x.id) {
            if (side === "a") known(x.id, match);
            else known(match, x.id);
            fresh.push(side === "a" ? [x.id, match] : [match, x.id]);
            report.plugins = { paired: (report.plugins?.paired ?? 0) + 1, copied: report.plugins?.copied ?? 0 };
          } else if (!match) {
            writes.push({ id: x.id, whole: true });
            report.plugins = { paired: report.plugins?.paired ?? 0, copied: (report.plugins?.copied ?? 0) + 1 };
          }
        }
        if (writes.length) copies.push({ set, writes });
      }
      return copies;
    };
    const copiesToB = await born(la, b, lb, pairs.ab, "a");
    const copiesToA = await born(lb, a, la, pairs.ba, "b");

    // Everyone else's sets, in a's ids, merged.
    const p = plan(la.sets, lb.sets.map((s) => swapSet(s, pairs.ba)));
    report.conflicts = p.conflicts;
    if (!opts.dry) {
      // An item brought back whole carries the sender's fields, read now, in the taker's ids.
      const filled = async (from: End, planned: Planned[], toFrom: ReadonlyMap<Id, Id>, fromTo: ReadonlyMap<Id, Id>): Promise<Planned[]> => {
        const ids = [...new Set(planned.flatMap((x) => x.writes.flatMap((w) => ("whole" in w && w.whole === true ? [toFrom.get(w.id) ?? w.id] : []))))];
        const items = ids.length ? await itemsOf(from, ids) : new Map<Id, Fields | null>();
        return planned.map((x) => ({
          ...x,
          writes: x.writes.flatMap((w): Write[] => {
            if (!("whole" in w) || w.whole !== true) return [w];
            const f = items.get(toFrom.get(w.id) ?? w.id);
            return f ? [{ id: w.id, whole: swapValue(f, fromTo) as Fields }] : [];
          }),
        }));
      };
      // To a: b's plugin copies (b's ids, kept), then b's sets (already in a's ids).
      for (const { set, writes } of [...(await filled(b, copiesToA, new Map(), pairs.ba)), ...(await filled(b, p.toA, pairs.ab, pairs.ba))]) {
        await apply(a, "a", writes, `From ${sb.name}: ${set.header.reason}`, set.header.authority, sb, set.id);
      }
      // To b: a's plugin copies, then a's sets, each swapped into b's ids.
      for (const { set, writes } of [...(await filled(a, copiesToB, new Map(), new Map())), ...(await filled(a, p.toB, new Map(), new Map()))]) {
        await apply(b, "b", writes.map((w) => swapWrite(w, pairs.ab)), `From ${sa.name}: ${set.header.reason}`, set.header.authority, sa, set.id);
      }
    }
  }

  // Each conflict's item by its title as it stands now (or would, dry).
  const ids = [...new Set(report.conflicts.map((c) => c.id))];
  if (ids.length) {
    const [ta, tb] = await Promise.all([itemsOf(a, ids), itemsOf(b, ids.map((id) => pairs.ab.get(id) ?? id))]);
    report.conflicts = report.conflicts.map((c) => {
      const t = (ta.get(c.id) ?? tb.get(pairs.ab.get(c.id) ?? c.id))?.title;
      return typeof t === "string" ? { ...c, title: t } : c;
    });
  }
  if (opts.dry) return report;

  for (let i = 0; i < fresh.length; i += LIMIT_MAX) {
    const chunk = fresh.slice(i, i + LIMIT_MAX);
    await output(a, "sync.mark", { peer: sb.id, name: sb.name, pairs: chunk as unknown as Json, only: true });
    await output(b, "sync.mark", { peer: sa.id, name: sa.name, pairs: chunk.map(([x, y]) => [y, x]) as unknown as Json, only: true });
  }
  const summary = (mine: "a" | "b") => ({ at: new Date().toISOString(), ...report, mine }) as unknown as Json;
  // Each map's cursor is its log's end as read: what the run wrote there comes after, and is a copy from the other, left out next time.
  await output(a, "sync.mark", { peer: sb.id, name: sb.name, ...(la.cursor ? { cursor: la.cursor } : {}), report: summary("a") });
  await output(b, "sync.mark", { peer: sa.id, name: sa.name, ...(lb.cursor ? { cursor: lb.cursor } : {}), report: summary("b") });
  return report;
}

/** A map's server, through its bridge's `POST /call`; `token` goes as `Authorization: Bearer` for a server that takes one. */
export function httpEnd(url: string, token?: string): End {
  const base = url.replace(/\/+$/, "");
  return {
    async call<T>(key: string, method: string, args: unknown[], as?: Actor): Promise<T> {
      const r = await fetch(`${base}/call`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ key, method, args, ...(as ? { actor: as } : {}) }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { value?: T; error?: string };
      if (!r.ok || body.error !== undefined) throw new Error(`${base} ${key}.${method}: ${body.error ?? `HTTP ${r.status}`}`);
      return body.value as T;
    },
  };
}
