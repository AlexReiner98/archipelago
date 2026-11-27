/**
 * Two maps' change sets since they last synced, merged field by field: the
 * later change wins (README "When both changed it"). Pure: what each map
 * sent in, what each must write out, and what conflicted. Nothing here
 * reads a graph; `factsFor` turns a plan's writes into facts against what
 * a map holds now.
 */
import type { Committed, Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";

export type Side = "a" | "b";
export type Fields = Record<string, Json>;

/**
 * What a map is to make true. A field set (or, with no `value`, unset); an
 * item brought back whole from the side that kept it (`whole`: true in a
 * plan, its fields once the sender's item is read); an item taken away.
 */
export type Write =
  | { id: Id; field: string; value?: Json }
  | { id: Id; whole: true | Fields }
  | { id: Id; remove: true };

/** A change set of one side, and what the other side writes for it. */
export interface Planned {
  set: Committed;
  writes: Write[];
}

/** Both sides changed it: a field to different values, or an item one side took away while the other changed it. */
export interface Conflict {
  id: Id;
  /** The field; absent, the item itself (taken away on one side, changed on the other). */
  field?: string;
  won: Side;
  a: { value?: Json; gone?: true; time: string; set: string };
  b: { value?: Json; gone?: true; time: string; set: string };
}

export interface Plan {
  /** The sets of `b` and what `a` writes for each, in `b`'s order; a set left with nothing to write is left out. */
  toA: Planned[];
  /** The same, `a`'s sets for `b`. */
  toB: Planned[];
  conflicts: Conflict[];
  /** Sets with nothing left to write once the later changes won. */
  idle: { a: number; b: number };
}

interface Touch {
  side: Side;
  set: Committed;
  /** Its place in its side's order. */
  n: number;
  id: Id;
  field: string;
  /** Absent: unset. */
  value?: Json;
  unset: boolean;
}

const key = (id: Id, field: string) => `${id}\u0000${field}`;

/** A set's last word on each field it touched: `+ v` sets it, a `-` with no `+` after unsets it. */
export function intentOf(facts: readonly Fact[]): Map<string, { id: Id; field: string; value?: Json; unset: boolean }> {
  const out = new Map<string, { id: Id; field: string; value?: Json; unset: boolean }>();
  for (const [op, id, field, value] of facts) {
    const k = key(id, field);
    out.delete(k); // keep the map in the order of last touch
    out.set(k, op === "+" ? { id, field, value, unset: false } : { id, field, unset: true });
  }
  return out;
}

/** Later is greater: by commit time, then within a side by its order; at an equal time across sides, `b` (the far map) is later. */
function later(x: Touch, y: Touch): boolean {
  if (x.set.committed !== y.set.committed) return x.set.committed > y.set.committed;
  if (x.side === y.side) return x.n > y.n;
  return x.side === "b";
}

/** JSON values equal, whatever their keys' order. */
export function same(x: Json | undefined, y: Json | undefined): boolean {
  return canon(x) === canon(y);
}
function canon(v: Json | undefined): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Fields)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/**
 * The plan. `a` and `b` are each side's sets since it last synced with the
 * other, in its own order, the other's own writes already left out.
 */
export function plan(a: readonly Committed[], b: readonly Committed[]): Plan {
  const touches: Touch[] = [];
  const read = (side: Side, sets: readonly Committed[]) =>
    sets.forEach((set, n) => {
      for (const t of intentOf(set.facts).values()) touches.push({ side, set, n, ...t });
    });
  read("a", a);
  read("b", b);

  /** The latest touch of each field, overall and on each side. */
  const latest = new Map<string, Touch>();
  const last = { a: new Map<string, Touch>(), b: new Map<string, Touch>() };
  /** Per item: each side's latest touch, and whether its last word on `type` took the item away. */
  const items = new Map<Id, { a?: Touch; b?: Touch; goneA?: Touch; goneB?: Touch }>();
  for (const t of touches) {
    const k = key(t.id, t.field);
    const l = latest.get(k);
    if (!l || later(t, l)) latest.set(k, t);
    const s = last[t.side].get(k);
    if (!s || later(t, s)) last[t.side].set(k, t);
    const it = items.get(t.id) ?? {};
    const mine = it[t.side];
    if (!mine || later(t, mine)) it[t.side] = t;
    items.set(t.id, it);
  }
  for (const [id, it] of items) {
    for (const side of ["a", "b"] as const) {
      const type = last[side].get(key(id, "type"));
      if (type?.unset) it[side === "a" ? "goneA" : "goneB"] = type;
    }
  }

  const writes = new Map<Committed, Write[]>();
  const add = (set: Committed, w: Write) => (writes.get(set) ?? writes.set(set, []).get(set)!).push(w);
  const conflicts: Conflict[] = [];
  const decided = new Set<Id>();
  const end = (t?: Touch, gone?: Touch) => (gone ? { gone: true as const, time: gone.set.committed, set: gone.set.id } : { ...(t && !t.unset ? { value: t.value } : {}), time: t!.set.committed, set: t!.set.id });

  // An item taken away on a side: it stays away unless the other side changed it later.
  for (const [id, it] of items) {
    if (!it.goneA && !it.goneB) continue;
    decided.add(id);
    if (it.goneA && it.goneB) continue; // away on both
    const [goneSide, gone, other] = it.goneA ? (["a", it.goneA, it.b] as const) : (["b", it.goneB!, it.a] as const);
    if (!other) {
      add(gone.set, { id, remove: true });
      continue;
    }
    const otherSide: Side = goneSide === "a" ? "b" : "a";
    const won: Side = later(gone, other) ? goneSide : otherSide;
    if (won === goneSide) add(gone.set, { id, remove: true });
    else add(other.set, { id, whole: true });
    conflicts.push({ id, won, a: goneSide === "a" ? end(undefined, gone) : end(other), b: goneSide === "b" ? end(undefined, gone) : end(other) });
  }

  // Every other field: the latest touch writes it, on the side that didn't make it.
  for (const [k, t] of latest) {
    if (decided.has(t.id)) continue;
    add(t.set, t.unset ? { id: t.id, field: t.field } : { id: t.id, field: t.field, value: t.value! });
    const other = last[t.side === "a" ? "b" : "a"].get(k);
    if (other && !(other.unset && t.unset) && !(!other.unset && !t.unset && same(other.value, t.value))) {
      const mine = last[t.side].get(k)!;
      conflicts.push({ id: t.id, field: t.field, won: t.side, a: end(t.side === "a" ? mine : other), b: end(t.side === "b" ? mine : other) });
    }
  }

  const out = (sets: readonly Committed[]) => sets.flatMap((set) => (writes.get(set)?.length ? [{ set, writes: writes.get(set)! }] : []));
  const toB = out(a), toA = out(b);
  return { toA, toB, conflicts, idle: { a: a.length - toB.length, b: b.length - toA.length } };
}

/** The ids a plan's writes read on the map that takes them. */
export function idsOf(writes: readonly Write[]): Id[] {
  return [...new Set(writes.map((w) => w.id))];
}

/**
 * The facts that make `writes` true on a map holding `now` (each id's
 * fields with `type`, or null where it holds none). A field already so
 * gives nothing; a value replaced is retracted first. An item made has its
 * `type` first; one taken away, last.
 */
export function factsFor(writes: readonly Write[], now: ReadonlyMap<Id, Fields | null>): Fact[] {
  const state = new Map<Id, Fields>();
  const of = (id: Id) => state.get(id) ?? state.set(id, { ...(now.get(id) ?? {}) }).get(id)!;
  const facts: Fact[] = [];
  const set = (id: Id, field: string, value: Json | undefined) => {
    const cur = of(id);
    if (same(cur[field], value)) return;
    if (field in cur) facts.push(["-", id, field, cur[field]!]);
    if (value === undefined) delete cur[field];
    else {
      facts.push(["+", id, field, value]);
      cur[field] = value;
    }
  };
  const fieldsFirst = (f: Fields) => ["type", ...Object.keys(f).filter((k) => k !== "type")].filter((k) => k in f);
  // A field write for an item made here: its type goes first.
  const byId = new Map<Id, Write[]>();
  for (const w of writes) (byId.get(w.id) ?? byId.set(w.id, []).get(w.id)!).push(w);
  for (const [id, ws] of byId) {
    const ordered = [...ws].sort((x, y) => Number("field" in y && y.field === "type") - Number("field" in x && x.field === "type"));
    for (const w of ordered) {
      if ("remove" in w) {
        const cur = of(id);
        for (const f of Object.keys(cur).filter((k) => k !== "type")) set(id, f, undefined);
        set(id, "type", undefined);
      } else if ("whole" in w) {
        if (w.whole === true) continue; // not read from the sender: nothing to write
        const cur = of(id);
        for (const f of fieldsFirst(w.whole)) set(id, f, w.whole[f]);
        for (const f of Object.keys(cur)) if (!(f in w.whole)) set(id, f, undefined);
      } else set(id, w.field, w.value);
    }
  }
  return facts;
}

/** Ids paired across two maps: the same item, made on each with its own id. */
export interface Pairs {
  /** a's id → b's. */
  ab: Map<Id, Id>;
  /** b's id → a's. */
  ba: Map<Id, Id>;
}

export const noPairs = (): Pairs => ({ ab: new Map(), ba: new Map() });

/** A value with every paired id in it swapped (a link's `from` and `to`, an `id` field, ids in a list). */
export function swapValue(v: Json, ids: ReadonlyMap<Id, Id>): Json {
  if (typeof v === "string") return ids.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => swapValue(x, ids));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapValue(x, ids)]));
  return v;
}

/** A set as the other map names things: its ids and the ids in its values swapped. */
export function swapSet(set: Committed, ids: ReadonlyMap<Id, Id>): Committed {
  if (!ids.size) return set;
  return { ...set, facts: set.facts.map(([op, id, field, value]) => [op, ids.get(id) ?? id, field, swapValue(value, ids)] as Fact) };
}

/** A write as the other map names things. */
export function swapWrite(w: Write, ids: ReadonlyMap<Id, Id>): Write {
  const id = ids.get(w.id) ?? w.id;
  if ("field" in w) return w.value === undefined ? { id, field: w.field } : { id, field: w.field, value: swapValue(w.value, ids) };
  if ("whole" in w) return { id, whole: w.whole === true ? true : (swapValue(w.whole, ids) as Fields) };
  return { id, remove: true };
}

/** Whether a set is a map's own plugin at work (`plugin:<id>`): each map runs its own, so it isn't copied. */
export const ownWork = (set: Committed) => set.header.actor.id.startsWith("plugin:");

/** The items a set makes: each id it gives a `type` it didn't have in the set before. */
export function birthsOf(set: Committed): { id: Id; type: string; title?: string }[] {
  const intent = intentOf(set.facts);
  const out: { id: Id; type: string; title?: string }[] = [];
  for (const t of intent.values()) {
    if (t.field !== "type" || t.unset || typeof t.value !== "string") continue;
    if (set.facts.some(([op, id, field]) => op === "-" && id === t.id && field === "type")) continue;
    const title = intent.get(key(t.id, "title"));
    out.push({ id: t.id, type: t.value, ...(title && typeof title.value === "string" ? { title: title.value } : {}) });
  }
  return out;
}

/** Items as facts make them, in order, from nothing: what a log replays to. */
export function replay(sets: Iterable<{ facts: readonly Fact[] }>, into = new Map<Id, Fields>()): Map<Id, Fields> {
  for (const s of sets) {
    for (const [op, id, field, value] of s.facts) {
      const it = into.get(id) ?? {};
      if (op === "+") it[field] = value;
      else if (same(it[field], value)) delete it[field];
      if (Object.keys(it).length) into.set(id, it);
      else into.delete(id);
    }
  }
  return into;
}

/** An item's name for pairing: its type and title; a link's type and its ends, as `ids` names them. */
function nameOf(f: Fields, ids?: ReadonlyMap<Id, Id>): string | undefined {
  if (typeof f.type !== "string") return undefined;
  if (typeof f.from === "string" && typeof f.to === "string") return `${f.type}\u0000→${ids?.get(f.from) ?? f.from}\u0000${ids?.get(f.to) ?? f.to}`;
  return typeof f.title === "string" && f.title ? `${f.type}\u0000${f.title}` : undefined;
}

export interface Join {
  pairs: [Id, Id][];
  /** What a writes (its own ids), and b. */
  toA: Write[];
  toB: Write[];
  /** Items the same on both, kept as one: by id, or paired by name. */
  same: number;
  /** Of those, how many differed and took the kept side's fields. */
  differed: number;
  /** Items only one map had, copied to the other. */
  copied: { toA: number; toB: number };
  /** Names more than one item has on a map: left unpaired, each copied. */
  ambiguous: number;
}

/**
 * Two maps that grew apart, made one, from their logs' items: an item with
 * the same id on both is one item; else items are paired by type and title
 * (a link by its type and its ends, once its ends are paired), where the
 * name is one item's on each map. Where a pair differs, `keep`'s fields
 * stay. What one map alone has is copied to the other, its id kept.
 */
export function join(a: ReadonlyMap<Id, Fields>, b: ReadonlyMap<Id, Fields>, keep: Side): Join {
  const out: Join = { pairs: [], toA: [], toB: [], same: 0, differed: 0, copied: { toA: 0, toB: 0 }, ambiguous: 0 };
  const ab = new Map<Id, Id>(), ba = new Map<Id, Id>();
  for (const id of a.keys()) if (b.has(id)) (ab.set(id, id), ba.set(id, id));
  // Items, then links (their ends paired by then): by name, where each map has one of it.
  for (const links of [false, true]) {
    const named = (m: ReadonlyMap<Id, Fields>, mine: Map<Id, Id>, ids?: ReadonlyMap<Id, Id>) => {
      const by = new Map<string, Id[]>();
      for (const [id, f] of m) {
        if (mine.has(id) || (typeof f.from === "string") !== links) continue;
        const n = nameOf(f, ids);
        if (n) (by.get(n) ?? by.set(n, []).get(n)!).push(id);
      }
      return by;
    };
    const na = named(a, ab, ab), nb = named(b, ba);
    for (const [n, ida] of na) {
      const idb = nb.get(n);
      if (!idb) continue;
      if (ida.length > 1 || idb.length > 1) {
        out.ambiguous++;
        continue;
      }
      ab.set(ida[0]!, idb[0]!);
      ba.set(idb[0]!, ida[0]!);
      if (ida[0] !== idb[0]) out.pairs.push([ida[0]!, idb[0]!]);
    }
  }
  for (const [ida, idb] of ab) {
    out.same++;
    const fa = a.get(ida)!, fb = b.get(idb)!;
    const kept = keep === "a" ? fa : fb;
    const asOther = keep === "a" ? (swapValue(fa, ab) as Fields) : (swapValue(fb, ba) as Fields);
    const theirs = keep === "a" ? fb : fa;
    if (!same(asOther, theirs)) {
      out.differed++;
      if (keep === "a") out.toB.push({ id: idb, whole: asOther });
      else out.toA.push({ id: ida, whole: asOther });
    }
    void kept;
  }
  for (const [id, f] of a) if (!ab.has(id)) (out.toB.push({ id, whole: swapValue(f, ab) as Fields }), out.copied.toB++);
  for (const [id, f] of b) if (!ba.has(id)) (out.toA.push({ id, whole: swapValue(f, ba) as Fields }), out.copied.toA++);
  return out;
}
