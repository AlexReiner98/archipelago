/**
 * The forward checker, apart from the runtime: given seeds (tests whose
 * inputs may have changed), it solves those tests and everything that needs
 * them, in order, and nothing else.
 *
 * A test's version is the stamp of its inputs: its rule's function and
 * params, its subject's stamp field (the one its domain names), the other
 * subject's for a two-subject test, and the version and result of each test
 * it needs. A result is for the version it was written at; a test whose
 * stamp no longer matches is pending until it is solved again. A person's
 * decision is kept while its version holds, and cleared when it moves.
 *
 * A test whose subject no domain judges now is left as it is: it waits for
 * one rather than being marked.
 */
import { createHash } from "node:crypto";
import type { Json } from "../../spec/common.ts";
import type { Item } from "../../spec/graph.ts";
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

/** What the checker needs of a domain: the field it stamps, and its judge. */
export interface Judging {
  stamp: string;
  judge(call: { subject: Item; other?: Item; fn: string; params: Json }): Promise<Verdict>;
}

/** A write on a test's word at a version: the fields to set (null clears). */
export interface Write {
  test: string;
  version: string;
  fields: Record<string, Json>;
  reason: string;
}

/** Keys a stamp keeps for itself: no domain may stamp a field of these names. */
export const STAMP_KEYS = ["fn", "params", "other", "needs"] as const;

const sorted = (v: Json): Json =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k]!)])) : v;

/**
 * A test's version: its rule's fn and params, its subject's stamp field
 * (under that field's name), the other subject's (only for a two-subject
 * test), and what it needs.
 */
export function stamp(inputs: { fn: Json; params: Json; field: string; value: Json; other?: Json; needs: [string, Json, Json][] }): string {
  const { fn, params, field, value, other, needs } = inputs;
  const body: Record<string, Json> = { fn, params, [field]: value, ...(other !== undefined ? { other } : {}), needs: [...needs].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
  return createHash("sha256").update(JSON.stringify(sorted(body))).digest("hex").slice(0, 16);
}

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

/**
 * Solves the tests downstream of `seeds`. Each test whose stamp moved is
 * written pending at its new version, then its result; one whose stamp
 * holds is left as it is, and what needs it is solved only if something
 * it needs moved. `domainOf` gives the judging for a subject's type.
 * Returns what it wrote, in order.
 */
export async function solve(seeds: string[], read: Read, domainOf: (type: string) => Judging | undefined, write: (w: Write) => Promise<void>): Promise<Write[]> {
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
    const subject = await one(read, id, CHECKS);
    const domain = subject ? domainOf(subject.type) : undefined;
    if (subject && !domain) continue; // nothing judges its subject now: leave it until something does
    const other = await one(read, id, AGAINST);
    const needed: Item[] = [];
    for (const l of await read.links(id, NEEDS, "out")) {
      const n = now.get(l.to) ?? (await read.get([l.to]))[0];
      if (n) needed.push(n);
    }
    const field = domain?.stamp ?? "subject";
    const version = stamp({
      fn: rule?.fields.fn ?? null,
      params: rule?.fields.params ?? null,
      field,
      value: subject?.fields[field] ?? null,
      ...(other ? { other: other.fields[field] ?? null } : {}),
      needs: needed.map((n) => [n.id, n.fields.version ?? null, n.fields.result ?? null]),
    });
    const f = test.fields;
    if (f.version === version && f.result && f.result !== "pending") continue;

    const clear: Record<string, Json> = f.decision && f.decided_version !== version ? { decision: null, decided_version: null } : {};
    await put({ test: id, version, fields: { result: "pending", findings: null, version, ...clear }, reason: "Its inputs changed: pending until solved" });

    let result: ResultKind;
    let findings: Json = null;
    if (!rule || rule.type !== RULE || typeof rule.fields.fn !== "string" || !subject || !domain || typeof subject.fields[field] !== "string") {
      result = "blocked";
      findings = [{ message: !rule ? "No rule applies to this test." : !subject ? "This test checks nothing." : "Its rule or subject is incomplete." }];
    } else if (other && typeof other.fields[field] !== "string") {
      result = "blocked";
      findings = [{ message: `What it is checked against has no ${field} yet.` }];
    } else if (needed.some((n) => n.fields.result !== "pass")) {
      result = "blocked";
      findings = [{ message: `Waits on ${needed.filter((n) => n.fields.result !== "pass").map((n) => n.id).join(", ")}, which didn't pass.` }];
    } else {
      try {
        const r = await domain.judge({ subject, ...(other ? { other } : {}), fn: rule.fields.fn, params: rule.fields.params ?? {} });
        result = r.passed ? "pass" : "fail";
        findings = r.findings;
      } catch (err) {
        result = "error";
        findings = [{ message: (err as Error).message }];
      }
    }
    await put({ test: id, version, fields: { result, findings }, reason: `Solved: ${result}` });
  }
  return done;
}

/**
 * The tests a committed change may have moved the inputs of: what it seeds.
 * `stampOf` gives the stamp field of a subject type, or undefined for a
 * type no domain judges.
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
