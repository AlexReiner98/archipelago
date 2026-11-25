/**
 * A rule change, previewed: the checker solves the tests the rule reaches
 * (and what needs them) against proposed params, over an overlay of the
 * graph held in memory, so nothing is written. Its answer is which tests
 * would flip.
 *
 * It calls a judge only for a test whose stamp would change, like a live
 * solve, and at most `judge` of them (default all): a preview costs judge
 * calls, so a domain whose judge is dear (a paid service) is previewed with
 * a small `judge`, or 0 to see only which tests would be judged.
 */
import type { Json } from "../../spec/common.ts";
import type { Item } from "../../spec/graph.ts";
import { solve, type Judging, type Read, type SolveOptions, type Write } from "./checker.ts";
import { APPLIES, RULE } from "./types.ts";

/** One test as a preview leaves it. */
export interface Previewed {
  test: string;
  title: string;
  before: { result: Json; version: Json; decision: Json };
  /** `pending` when it would be judged but the preview didn't (over `judge`). */
  after: { result: Json; version: Json; decision: Json; findings: Json };
  /** Its result would be another. */
  flips: boolean;
  judged: boolean;
}

export interface Preview {
  rule: string;
  params: Json;
  /** Tests whose version would move, in the order they'd be solved. */
  tests: Previewed[];
  /** How many of them would flip. */
  flips: number;
  /** How many judge calls the preview made, and how many it held back. */
  judged: number;
  held_back: number;
}

/**
 * Previews `params` on `rule`: solves over an overlay, judging at most
 * `judge` tests. `domainOf` and `opts.today` as a live solve's.
 */
export async function preview(
  rule: string,
  params: Json,
  read: Read,
  domainOf: (type: string, fn?: string) => Judging | undefined,
  opts: { judge?: number; today?: SolveOptions["today"] } = {},
): Promise<Preview> {
  const [r] = await read.get([rule]);
  if (!r || r.type !== RULE) throw new Error(`${rule} is not a rule.`);
  const overlay = new Map<string, Item>([[rule, { ...r, fields: { ...r.fields, params } }]]);
  const over: Read = {
    get: async (ids) => {
      const got = await read.get(ids.filter((id) => !overlay.has(id)));
      let i = 0;
      return ids.map((id) => overlay.get(id) ?? got[i++] ?? null);
    },
    links: read.links,
  };
  const before = new Map<string, Item>();
  const write = async (w: Write) => {
    const t = overlay.get(w.test) ?? (await read.get([w.test]))[0];
    if (!t) return;
    if (!before.has(w.test)) before.set(w.test, t);
    const fields = { ...t.fields };
    for (const [k, v] of Object.entries(w.fields)) {
      if (v === null) delete fields[k];
      else fields[k] = v;
    }
    overlay.set(w.test, { ...t, fields });
  };
  const budget = opts.judge ?? Infinity;
  let judged = 0;
  let held = 0;
  const judgedIds = new Set<string>();
  const may = (id: string) => {
    if (judged >= budget) return (held++, false);
    judged++;
    judgedIds.add(id);
    return true;
  };
  const seeds = (await read.links(rule, APPLIES, "in")).map((l) => l.from);
  await solve(seeds, over, domainOf, write, { may, ...(opts.today ? { today: opts.today } : {}) });
  const tests: Previewed[] = [];
  for (const [id, was] of before) {
    const now = overlay.get(id)!;
    const b = { result: was.fields.result ?? null, version: was.fields.version ?? null, decision: was.fields.decision ?? null };
    const a = { result: now.fields.result ?? null, version: now.fields.version ?? null, decision: now.fields.decision ?? null, findings: now.fields.findings ?? null };
    tests.push({ test: id, title: String(was.fields.title ?? id), before: b, after: a, flips: a.result !== "pending" && a.result !== b.result, judged: judgedIds.has(id) });
  }
  return { rule, params, tests, flips: tests.filter((t) => t.flips).length, judged, held_back: held };
}
