/**
 * The forward checker, apart from the runtime: given seeds (tests whose
 * inputs may have changed), it solves those tests and everything that needs
 * them, in order, and nothing else.
 *
 * A test's version is the stamp of its inputs. Two ways to say what they
 * are:
 *
 * - Recorded reads (a domain with no `stamp`). The judge gets a tracked
 *   reader over the graph and reads what it needs, in bounded reads; the
 *   test keeps the list of what was read (`reads`: keys, not values), and
 *   the stamp is the hash of the values read, the rule's function and
 *   params, the subjects' ids, and the version and result of each test it
 *   needs. To tell whether a test's inputs moved, the checker reads the
 *   same keys again (a replay, no judge) and compares stamps. A judge that
 *   follows links from its subject stamps what it reached, so a composite
 *   subject is just a judge that reads further.
 * - A declared stamp field (a domain with `stamp`), for a judge that can't
 *   read the graph, such as a remote service: it gets snapshots of its
 *   subjects, and the stamp is that field of each, as before (pinned in the
 *   tests, so a map solved before keeps its versions).
 *
 * A result is for the version it was written at; a test whose stamp no
 * longer matches is pending until it is solved again. A person's decision
 * is kept while its version holds, and cleared when it moves.
 *
 * A test no domain judges now is left as it is: it waits for one rather
 * than being marked.
 */
import { createHash } from "node:crypto";
import type { Json } from "../../spec/common.ts";
import { LIMIT_MAX, type Item } from "../../spec/graph.ts";
import { AGAINST, APPLIES, CHECKS, NEEDS, RULE, TEST, TEST_LINKS, type ResultKind } from "./types.ts";

/** What the checker reads of the graph. */
export interface Read {
  get(ids: string[]): Promise<(Item | null | undefined)[]>;
  /** Every link of `kind` with `id` at one end: `out` from it, `in` to it. */
  links(id: string, kind: string, dir: "out" | "in"): Promise<{ id: string; from: string; to: string }[]>;
}

/** What a judge answers. */
export interface Verdict {
  passed: boolean;
  findings: Json[];
}

/** A page of links, as a judge's reader answers it. */
export interface LinkPage {
  items: { id: string; from: string; to: string }[];
  /** The cursor for the next page; absent on the last. */
  next?: string;
}

/**
 * The tracked reader a judge with no declared stamp gets. Every read is
 * bounded (at most LIMIT_MAX ids, a page of at most LIMIT_MAX links) and
 * recorded: what it read goes into the test's stamp.
 */
export interface Reader {
  /** Items by id, null for a missing one. Reading a field records it; listing an item's fields records them all. */
  get(ids: string[]): Promise<(Item | null)[]>;
  /** One page of the links of `type` at `id`, in a stable order. */
  links(id: string, opts: { type: string; dir: "out" | "in" }, page?: { limit?: number; after?: string }): Promise<LinkPage>;
  /** Today's date, `YYYY-MM-DD` (UTC). A test that reads it is solved again when the day turns. */
  today(): string;
}

/** What a judge is called with. */
export interface JudgeCall {
  /** The first subject (`checks`). */
  subject: Item;
  /** The `against` subject, for a two-subject test. */
  other?: Item;
  /** Every subject: its `checks` links, then its `against` ones. */
  subjects: Item[];
  fn: string;
  params: Json;
  /** The tracked reader; absent for a domain with a declared stamp. */
  read?: Reader;
}

/** What the checker needs of a domain: its judge, and the field it stamps if it can't read the graph. */
export interface Judging {
  /** The subject's field a judge that can't read the graph is stamped by. Absent: reads are recorded. */
  stamp?: string;
  judge(call: JudgeCall): Promise<Verdict>;
  /**
   * Optional: a finding's identity (the face it is on, the field it names),
   * or undefined for one that has none. With it, a decision outlives a moved
   * version while the result is the same and every finding decided on is
   * still found; without it, a decision is cleared whenever the version moves.
   */
  finding?(finding: Json): string | undefined;
}

/** A write on a test's word at a version: the fields to set (null clears). */
export interface Write {
  test: string;
  version: string;
  fields: Record<string, Json>;
  reason: string;
}

/** Keys a stamp keeps for itself: no domain may stamp a field of these names. */
export const STAMP_KEYS = ["fn", "params", "other", "also", "needs", "subjects", "reads"] as const;

/** The most reads one judge call may make, so a test's `reads` stays small. */
export const READS_MAX = 1000;

const sorted = (v: Json): Json =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k]!)])) : v;

const hash = (body: Json) => createHash("sha256").update(JSON.stringify(sorted(body))).digest("hex").slice(0, 16);
const byFirst = (needs: [string, Json, Json][]) => [...needs].sort((a, b) => (a[0] < b[0] ? -1 : 1));

/**
 * A declared-stamp test's version: its rule's fn and params, its subject's
 * stamp field (under that field's name), the other subject's (only for a
 * two-subject test), any further subjects' (`also`), and what it needs.
 */
export function stamp(inputs: { fn: Json; params: Json; field: string; value: Json; other?: Json; also?: Json[]; needs: [string, Json, Json][] }): string {
  const { fn, params, field, value, other, also, needs } = inputs;
  const body: Record<string, Json> = { fn, params, [field]: value, ...(other !== undefined ? { other } : {}), ...(also?.length ? { also } : {}), needs: byFirst(needs) };
  return hash(body);
}

/** A recorded-reads test's version: its rule's fn and params, its subjects, the values its judge read, and what it needs. */
export function traced(inputs: { fn: Json; params: Json; subjects: string[]; values: Json; needs: [string, Json, Json][] }): string {
  return hash({ fn: inputs.fn, params: inputs.params, subjects: inputs.subjects, reads: inputs.values, needs: byFirst(inputs.needs) });
}

// ---- Recorded reads ----

/** What a judge read, as keys (kept on the test as `reads`): fields per item (`*` for all), link pages, and whether it read the day. */
export interface Reads {
  items: [string, string[] | "*"][];
  links: [string, string, "out" | "in", number, string | null][];
  today?: boolean;
}

/** What those keys read: the items, the link pages and the day. */
interface Seen {
  items: Map<string, Item | null>;
  links: Map<string, LinkPage>;
  today?: string;
}

const linkKey = (id: string, type: string, dir: string, limit: number, after: string | null) => JSON.stringify([id, type, dir, limit, after]);

/** One page of links, from every link of a kind: ordered by id, after the cursor. */
async function linkPage(read: Read, id: string, type: string, dir: "out" | "in", limit: number, after: string | null): Promise<LinkPage> {
  const all = (await read.links(id, type, dir)).map((l) => ({ id: l.id, from: l.from, to: l.to })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = after === null ? all : all.filter((l) => l.id > after);
  const items = rest.slice(0, limit);
  return rest.length > limit ? { items, next: items.at(-1)!.id } : { items };
}

/** The values of what was read, in a fixed order: what a recorded stamp hashes. */
function values(reads: Reads, seen: Seen): Json {
  const items = [...reads.items]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, fields]) => {
      const it = seen.items.get(id) ?? null;
      if (!it) return [id, null];
      const f = fields === "*" ? it.fields : Object.fromEntries([...fields].sort().map((k) => [k, it.fields[k] ?? null]));
      return [id, it.type, f];
    });
  const links = reads.links
    .map((k) => linkKey(...k))
    .sort()
    .map((k) => {
      const p = seen.links.get(k);
      return [k, p ? p.items.map((l) => [l.id, l.from, l.to]) : null, p?.next ?? null];
    });
  return { items, links, ...(reads.today ? { today: seen.today ?? null } : {}) } as Json;
}

/** Reads the keys again from the graph as it is now: a replay, with no judge. */
async function replay(reads: Reads, read: Read, today: () => string): Promise<Seen> {
  const seen: Seen = { items: new Map(), links: new Map() };
  const ids = reads.items.map(([id]) => id);
  for (let i = 0; i < ids.length; i += LIMIT_MAX) {
    const chunk = ids.slice(i, i + LIMIT_MAX);
    const got = await read.get(chunk);
    chunk.forEach((id, j) => seen.items.set(id, got[j] ?? null));
  }
  for (const [id, type, dir, limit, after] of reads.links) seen.links.set(linkKey(id, type, dir, limit, after), await linkPage(read, id, type, dir, limit, after));
  if (reads.today) seen.today = today();
  return seen;
}

/** A test's `reads` field as Reads, or empty when it has none (or it isn't one). */
export function readsOf(v: Json | undefined): Reads {
  const r = v as Partial<Reads> | null | undefined;
  return { items: Array.isArray(r?.items) ? r!.items : [], links: Array.isArray(r?.links) ? r!.links : [], ...(r?.today ? { today: true } : {}) };
}

/** A tracked reader over `read`, recording into a trace. */
export function tracker(read: Read, today: () => string): { reader: Reader; reads(): Reads; seen(): Seen; track(item: Item | null): Item | null } {
  const fields = new Map<string, Set<string> | "*">();
  const seen: Seen = { items: new Map(), links: new Map() };
  const linkKeys = new Map<string, [string, string, "out" | "in", number, string | null]>();
  let count = 0;
  let readToday = false;
  const tick = () => {
    if (++count > READS_MAX) throw new Error(`The judge read more than ${READS_MAX} times.`);
  };
  const note = (id: string, field: string | "*") => {
    const had = fields.get(id);
    if (had === "*") return;
    if (field === "*") fields.set(id, "*");
    else (had ?? fields.set(id, new Set()).get(id)! as Set<string>).add(field);
  };
  const track = (item: Item | null): Item | null => {
    if (!item) return null;
    const id = item.id;
    if (!fields.has(id)) fields.set(id, new Set());
    seen.items.set(id, item);
    const f = new Proxy(item.fields, {
      get: (t, k) => (typeof k === "string" && note(id, k), Reflect.get(t, k)),
      has: (t, k) => (typeof k === "string" && note(id, k), Reflect.has(t, k)),
      ownKeys: (t) => (note(id, "*"), Reflect.ownKeys(t)),
      getOwnPropertyDescriptor: (t, k) => (typeof k === "string" && note(id, k), Reflect.getOwnPropertyDescriptor(t, k)),
      set: () => false,
      deleteProperty: () => false,
    });
    return { id, type: item.type, fields: f };
  };
  const reader: Reader = {
    async get(ids) {
      if (ids.length > LIMIT_MAX) throw new Error(`A read gets at most ${LIMIT_MAX} ids.`);
      tick();
      const got = await read.get(ids);
      return ids.map((id, i) => {
        const it = got[i] ?? null;
        if (!it) {
          if (!fields.has(id)) fields.set(id, new Set());
          seen.items.set(id, null);
          return null;
        }
        return track(it);
      });
    },
    async links(id, opts, page = {}) {
      const limit = Math.min(Math.max(1, page.limit ?? LIMIT_MAX), LIMIT_MAX);
      const after = page.after ?? null;
      tick();
      const key = linkKey(id, opts.type, opts.dir, limit, after);
      const p = await linkPage(read, id, opts.type, opts.dir, limit, after);
      linkKeys.set(key, [id, opts.type, opts.dir, limit, after]);
      seen.links.set(key, p);
      return { items: p.items.map((l) => ({ ...l })), ...(p.next ? { next: p.next } : {}) };
    },
    today() {
      readToday = true;
      seen.today ??= today();
      return seen.today;
    },
  };
  const reads = (): Reads => ({
    items: [...fields].map(([id, f]) => [id, f === "*" ? "*" : [...f].sort()] as [string, string[] | "*"]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    links: [...linkKeys.values()].sort((a, b) => (linkKey(...a) < linkKey(...b) ? -1 : 1)),
    ...(readToday ? { today: true } : {}),
  });
  return { reader, reads, seen: () => seen, track };
}

/**
 * Which tests read what, from their `reads`: so a change to an item, the
 * links at an item, or the day seeds the tests that read it. In memory,
 * rebuilt from the tests; a seed it gives too many is replayed and left.
 */
export class ReadsIndex {
  private by = new Map<string, Set<string>>();
  private of = new Map<string, string[]>();
  /** Sets (or, with null, clears) what one test read. */
  set(test: string, reads: Reads | null) {
    for (const k of this.of.get(test) ?? []) this.by.get(k)?.delete(test);
    this.of.delete(test);
    if (!reads) return;
    const keys = new Set<string>();
    for (const [id] of reads.items) keys.add(`i:${id}`);
    for (const [id] of reads.links) keys.add(`l:${id}`);
    if (reads.today) keys.add("today");
    for (const k of keys) (this.by.get(k) ?? this.by.set(k, new Set()).get(k)!).add(test);
    this.of.set(test, [...keys]);
  }
  /** The tests a committed change may have moved a read of. */
  seeds(facts: [string, string, string, Json][]): string[] {
    const out = new Set<string>();
    const hit = (k: string) => this.by.get(k)?.forEach((t) => out.add(t));
    for (const [, id, field, value] of facts) {
      hit(`i:${id}`);
      if ((field === "from" || field === "to") && typeof value === "string") hit(`l:${value}`);
    }
    return [...out];
  }
  /** The tests that read the day. */
  today(): string[] {
    return [...(this.by.get("today") ?? [])];
  }
  get size() {
    return this.of.size;
  }
}

// ---- Solving ----

/** Every test downstream of the seeds (them included), each after the tests it needs. */
export async function order(seeds: string[], read: Read): Promise<string[]> {
  const down = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.shift()!;
    if (down.has(id)) continue;
    down.add(id);
    for (const l of await read.links(id, NEEDS, "in")) queue.push(l.from);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = async (id: string) => {
    if (seen.has(id)) return;
    seen.add(id); // `needs` is held acyclic, so this never loops back
    for (const l of await read.links(id, NEEDS, "out")) if (down.has(l.to)) await visit(l.to);
    out.push(id);
  };
  for (const id of down) await visit(id);
  return out;
}

const one = async (read: Read, id: string, kind: string): Promise<Item | null> => {
  const l = (await read.links(id, kind, "out"))[0];
  return l ? ((await read.get([l.to]))[0] ?? null) : null;
};

const ids = async (read: Read, id: string, kind: string) => (await read.links(id, kind, "out")).map((l) => l.to);

/** What a test is, read once per pass: its rule, its subjects, what it needs, and its domain. */
interface Shape {
  rule: Item | null;
  checks: string[];
  against: string[];
  needed: Item[];
  domain: Judging | undefined;
  first: Item | null;
}

/** Options for a pass. */
export interface SolveOptions {
  /** Today's date for judges that read it; default the clock's, UTC. */
  today?: () => string;
  /** Kept up to date with each recorded test's reads. */
  index?: ReadsIndex;
  /** Judges only the tests this says yes to (by its version, as it would be); the rest stay pending. A preview's guard. */
  may?: (test: string) => boolean;
}

export const utcToday = () => new Date().toISOString().slice(0, 10);

/**
 * Solves the tests downstream of `seeds`. Each test whose stamp moved is
 * written pending at its new version, then its result; one whose stamp
 * holds is left as it is, and what needs it is solved only if something
 * it needs moved. `domainOf` gives the judging for a subject's type and a
 * rule's function. Returns what it wrote, in order.
 */
export async function solve(
  seeds: string[],
  read: Read,
  domainOf: (type: string, fn?: string) => Judging | undefined,
  write: (w: Write) => Promise<void>,
  opts: SolveOptions = {},
): Promise<Write[]> {
  const today = opts.today ?? utcToday;
  const done: Write[] = [];
  const now = new Map<string, Item>(); // tests as this pass leaves them
  const put = async (w: Write) => {
    await write(w);
    done.push(w);
    const t = now.get(w.test)!;
    now.set(w.test, { ...t, fields: { ...t.fields, ...w.fields } });
  };
  for (const id of await order(seeds, read)) {
    const test = now.get(id) ?? (await read.get([id]))[0];
    if (!test || test.type !== TEST) continue;
    now.set(id, test);
    const rule = await one(read, id, APPLIES);
    const checks = await ids(read, id, CHECKS);
    const against = await ids(read, id, AGAINST);
    const first = checks.length ? ((await read.get([checks[0]!]))[0] ?? null) : null;
    const fn = typeof rule?.fields.fn === "string" ? rule.fields.fn : undefined;
    const domain = domainOf(first?.type ?? "", fn);
    if (first && !domain) continue; // nothing judges it now: leave it until something does
    const needed: Item[] = [];
    for (const l of await read.links(id, NEEDS, "out")) {
      const n = now.get(l.to) ?? (await read.get([l.to]))[0];
      if (n) needed.push(n);
    }
    const shape: Shape = { rule, checks, against, needed, domain, first };
    const needs = needed.map((n) => [n.id, n.fields.version ?? null, n.fields.result ?? null] as [string, Json, Json]);
    if (!domain || domain.stamp !== undefined) await solveDeclared(id, test, shape, needs, read, put, opts);
    else await solveTraced(id, test, shape, needs, read, put, today, opts);
  }
  return done;
}

/** Why a test can't be judged as it stands (its rule or subject), or null. */
function incomplete(shape: Shape): string | null {
  const { rule, first, domain } = shape;
  if (!rule || rule.type !== RULE || typeof rule.fields.fn !== "string" || !first || !domain) return !rule ? "No rule applies to this test." : !first ? "This test checks nothing." : "Its rule or subject is incomplete.";
  return null;
}

/** Why a test waits on the tests it needs, or null. */
function waiting(shape: Shape): string | null {
  const failed = shape.needed.filter((n) => n.fields.result !== "pass");
  return failed.length ? `Waits on ${failed.map((n) => n.id).join(", ")}, which didn't pass.` : null;
}

/** What a pending write does to a decision: cleared when the version moves, unless the domain can carry it by finding (then the result decides). */
const clearing = (f: Record<string, Json>, version: string, domain: Judging | undefined): Record<string, Json> =>
  !f.decision || f.decided_version === version ? {} : domain?.finding && Array.isArray(f.decided_findings) ? {} : { decision: null, decided_version: null, decided_findings: null };

/** A finding's identities, by the domain's hook: undefined for one it can't name. */
export function identities(findings: Json, finding: (f: Json) => string | undefined): (string | undefined)[] {
  return (Array.isArray(findings) ? findings : []).map((x) => {
    try {
      return finding(x);
    } catch {
      return undefined;
    }
  });
}

/**
 * What a result write does to a decision carried past a moved version: kept
 * (at the new version) when the result is the one decided on and every
 * finding decided on is still found by identity; else cleared.
 */
export function carried(was: Record<string, Json>, result: ResultKind, findings: Json, version: string, domain: Judging | undefined): Record<string, Json> {
  if (!was.decision || was.decided_version === version) return {};
  const decided = was.decided_findings;
  if (!domain?.finding || !Array.isArray(decided)) return {}; // cleared at pending already
  const now = new Set(identities(findings, domain.finding).filter((x): x is string => x !== undefined));
  const keep = (result === "pass" || result === "fail") && result === was.result && decided.every((x) => typeof x === "string" && now.has(x));
  return keep ? { decided_version: version } : { decision: null, decided_version: null, decided_findings: null };
}

async function solveDeclared(id: string, test: Item, shape: Shape, needs: [string, Json, Json][], read: Read, put: (w: Write) => Promise<void>, opts: SolveOptions) {
  const { rule, first, domain, against, checks } = shape;
  const field = domain?.stamp ?? "subject";
  const other = against.length ? ((await read.get([against[0]!]))[0] ?? null) : null;
  const more = checks.length > 1 ? (await read.get(checks.slice(1))).map((x) => x ?? null) : [];
  const version = stamp({
    fn: rule?.fields.fn ?? null,
    params: rule?.fields.params ?? null,
    field,
    value: first?.fields[field] ?? null,
    ...(other ? { other: other.fields[field] ?? null } : {}),
    ...(more.length ? { also: more.map((m) => m?.fields[field] ?? null) } : {}),
    needs,
  });
  const f = test.fields;
  if (f.version === version && f.result && f.result !== "pending") return;
  await put({ test: id, version, fields: { result: "pending", findings: null, version, ...clearing(f, version, domain) }, reason: "Its inputs changed: pending until solved" });
  if (opts.may && !opts.may(id)) return;

  let result: ResultKind;
  let findings: Json = null;
  const blocked = incomplete(shape) ?? (typeof first!.fields[field] !== "string" || more.some((m) => typeof m?.fields[field] !== "string") ? "Its rule or subject is incomplete." : null);
  const waits = waiting(shape);
  if (blocked) {
    result = "blocked";
    findings = [{ message: blocked }];
  } else if (other && typeof other.fields[field] !== "string") {
    result = "blocked";
    findings = [{ message: `What it is checked against has no ${field} yet.` }];
  } else if (waits) {
    result = "blocked";
    findings = [{ message: waits }];
  } else {
    try {
      const subjects = [first!, ...(more as Item[]), ...(other ? [other] : [])];
      const r = await domain!.judge({ subject: first!, ...(other ? { other } : {}), subjects, fn: rule!.fields.fn as string, params: rule!.fields.params ?? {} });
      result = r.passed ? "pass" : "fail";
      findings = r.findings;
    } catch (err) {
      result = "error";
      findings = [{ message: (err as Error).message }];
    }
  }
  await put({ test: id, version, fields: { result, findings, ...carried(f, result, findings, version, domain) }, reason: `Solved: ${result}` });
}

async function solveTraced(id: string, test: Item, shape: Shape, needs: [string, Json, Json][], read: Read, put: (w: Write) => Promise<void>, today: () => string, opts: SolveOptions) {
  const { rule, domain, checks, against } = shape;
  const subjects = [...checks, ...against];
  const fn = rule?.fields.fn ?? null;
  const params = rule?.fields.params ?? null;
  const f = test.fields;
  const before = readsOf(f.reads);
  const now = traced({ fn, params, subjects, values: values(before, await replay(before, read, today)), needs });
  if (f.version === now && f.result && f.result !== "pending") return;
  await put({ test: id, version: now, fields: { result: "pending", findings: null, version: now, ...clearing(f, now, domain) }, reason: "Its inputs changed: pending until solved" });
  if (opts.may && !opts.may(id)) return;

  const blocked = incomplete(shape) ?? waiting(shape);
  let result: ResultKind;
  let findings: Json = null;
  let reads: Reads = { items: [], links: [] };
  let version: string;
  if (blocked) {
    result = "blocked";
    findings = [{ message: blocked }];
    version = traced({ fn, params, subjects, values: values(reads, { items: new Map(), links: new Map() }), needs });
  } else {
    const t = tracker(read, today);
    try {
      const got = await t.reader.get(subjects.slice(0, LIMIT_MAX));
      const items = got.filter((x): x is Item => !!x);
      const r = await domain!.judge({ subject: items[0]!, ...(against.length && got[checks.length] ? { other: got[checks.length]! } : {}), subjects: items, fn: fn as string, params: params ?? {}, read: t.reader });
      result = r.passed ? "pass" : "fail";
      findings = r.findings;
    } catch (err) {
      result = "error";
      findings = [{ message: (err as Error).message }];
    }
    reads = t.reads();
    version = traced({ fn, params, subjects, values: values(reads, t.seen()), needs });
  }
  const keep: Json = reads.items.length || reads.links.length || reads.today ? (reads as unknown as Json) : null;
  opts.index?.set(id, keep ? reads : null);
  const fields: Record<string, Json> = { result, findings, reads: keep, ...carried(f, result, findings, version, domain) };
  if (version !== now) fields.version = version;
  await put({ test: id, version, fields, reason: `Solved: ${result}` });
}

/**
 * The tests a committed change may have moved the inputs of, for tests
 * with a declared stamp and the links that make every test: what it seeds.
 * `stampOf` gives the stamp field of a subject type, or undefined for a type
 * no declared-stamp domain judges. Recorded reads seed through ReadsIndex.
 */
export async function seeds(
  facts: [string, string, string, Json][],
  read: Read,
  typeOf: (id: string) => Promise<string | undefined>,
  stampOf: (type: string) => string | undefined,
): Promise<string[]> {
  const out = new Set<string>();
  const byId = new Map<string, Map<string, Json>>();
  for (const [, id, field, value] of facts) (byId.get(id) ?? byId.set(id, new Map()).get(id)!).set(field, value);
  for (const [id, fields] of byId) {
    const type = (fields.get("type") as string | undefined) ?? (await typeOf(id));
    if (!type) continue;
    if (type === TEST && fields.has("type")) out.add(id);
    else if ((TEST_LINKS as readonly string[]).includes(type)) {
      const from = fields.get("from") ?? (await read.get([id]))[0]?.fields.from;
      if (typeof from === "string") out.add(from);
    } else if (type === RULE && (fields.has("fn") || fields.has("params"))) {
      for (const l of await read.links(id, APPLIES, "in")) out.add(l.from);
    } else {
      const field = stampOf(type);
      if (field && fields.has(field)) {
        for (const l of await read.links(id, CHECKS, "in")) out.add(l.from);
        for (const l of await read.links(id, AGAINST, "in")) out.add(l.from);
      }
    }
  }
  return [...out];
}
