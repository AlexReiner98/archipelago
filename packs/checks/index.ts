/**
 * The checks pack: rules and tests on the map, and the forward checker that
 * keeps every test's result true to its inputs.
 *
 * It does not know what a subject is. A domain pack plugs in through
 * `checks.domain`: the type of item its tests check, the field of it that
 * goes into a test's stamp, a judge, and (for the rejections reading) each
 * rule function's limit. The checker solves a change's tests and what needs
 * them, through the subject's judge, each result written on the test's word
 * at its version (`action.attest`). A person accepts or rejects a result
 * with `checks.decide`; `checks.rejections` reads what those decisions say
 * about each rule.
 */
import type { ActionAttest, ActionRegister } from "../../spec/action.ts";
import type { Dispose, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import type { TypesAcyclic, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { seeds, solve, STAMP_KEYS, type Judging, type Read, type Verdict, type Write } from "./checker.ts";
import { decidedOf, read as readRejections, type Decided, type RuleLimit, type RuleReading } from "./rejections.ts";
import { APPLIES, DECISIONS, FLAVOURS, LINKS, NEEDS, RULE, TEST, TEST_LINKS, type Decision } from "./types.ts";

export type { Judging, Verdict } from "./checker.ts";
export type { RuleLimit, RuleReading } from "./rejections.ts";
export { AGAINST, APPLIES, CHECKS, DECISIONS, NEEDS, RESULTS, RULE, TEST } from "./types.ts";

/** A domain: what its tests check, and how. */
export interface CheckDomain extends Judging {
  /** The type of item its tests check (`checks`, and `against` for a two-subject test). */
  subject: string;
  /** The subject's field that goes into a test's stamp: when it moves, the subject's tests are solved again. */
  stamp: string;
  /** Each rule function's limit, for `checks.rejections`. */
  limits?(): Promise<RuleLimit[]>;
}

/** `checks.domain`: this pack's own key. */
export interface ChecksDomain {
  /** Plugs a domain in, as the calling pack's: one per subject type. */
  register(domain: CheckDomain): Dispose;
}

const PAGE = 500;
/** The actor a result is written as: `test:<id>`, from action.attest. */
const ATTESTED = "test:";

const refuse = (code: string, message: string) => new Refused({ code: `checks.${code}`, message, by: { pack: "checks" } });

/** Reads the graph for the checker: items by id, and every page of links of a kind at an item. */
export function reader(graph: GraphRead): Read {
  return {
    get: (ids) => graph.get(ids),
    async links(id, kind, dir) {
      const out: { id: string; from: string; to: string }[] = [];
      let after: string | undefined;
      do {
        const page = await graph.links(id, { type: kind, dir }, { limit: PAGE, ...(after ? { after } : {}) });
        for (const l of page.items) if ((dir === "out" ? l.from : l.to) === id) out.push({ id: l.id, from: l.from, to: l.to });
        after = page.next;
      } while (after);
      return out;
    },
  };
}

async function every(graph: GraphRead, type: string): Promise<Item[]> {
  const out: Item[] = [];
  let after: string | undefined;
  do {
    const page = await graph.of(type, { limit: PAGE, ...(after ? { after } : {}) });
    out.push(...page.items);
    after = page.next;
  } while (after);
  return out;
}

/** The facts that set `fields` on `item`: each changed field's old value out, its new one in (null clears). */
function setting(item: Item, fields: Record<string, Json>): Fact[] {
  const facts: Fact[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const was = item.fields[k];
    if (JSON.stringify(was) === JSON.stringify(v)) continue;
    if (was !== undefined) facts.push(["-", item.id, k, was]);
    if (v !== null) facts.push(["+", item.id, k, v]);
  }
  return facts;
}

const checks: Pack = {
  id: "checks",
  about: "Rules and tests on the map, kept true to what they check by a forward checker, and a person's accept or reject of each result.",
  inject: ["types.define", "types.acyclic", "action.register", "action.attest", "graph.read", "graph.watch"],
  apply(ctx: Context) {
    const define = ctx.get<TypesDefine>("types.define");
    for (const f of FLAVOURS) define.flavour(f);
    for (const l of LINKS) define.link(l);
    ctx.get<TypesAcyclic>("types.acyclic").hold(NEEDS);

    const graph = ctx.get<GraphRead>("graph.read");
    const watch = ctx.get<GraphWatch>("graph.watch");
    const attest = ctx.get<ActionAttest>("action.attest");
    const read = reader(graph);
    const domains = new Map<string, CheckDomain>();
    const domainOf = (type: string) => domains.get(type);

    const register = ctx.get<ActionRegister>("action.register");
    // The checker writes through this action, on the test's word.
    register.register({
      name: "checks.result",
      title: "Write a test's result",
      doc: "Sets a test's result fields. Called by the forward checker through action.attest, at the test's version.",
      input: { type: "object", properties: { test: { type: "string" }, fields: { type: "object" } }, required: ["test", "fields"] },
      async run(input: { test: string; fields: Record<string, Json> }, call) {
        const [t] = await graph.get([input.test]);
        if (!t || t.type !== TEST) throw refuse("not_a_test", `${input.test} is not a test.`);
        call.write(setting(t, input.fields));
        return { test: t.id };
      },
    });

    register.register({
      name: "checks.decide",
      title: "Accept or reject a test's result",
      doc: "A person's call on a test's result at its version. Kept while the version holds; the checker clears it when the inputs move.",
      input: { type: "object", properties: { test: { type: "string" }, decision: { enum: [...DECISIONS] } }, required: ["test", "decision"] },
      async run(input: { test: string; decision: Decision }, call) {
        const [t] = await graph.get([input.test]);
        if (!t || t.type !== TEST) throw refuse("not_a_test", `${input.test} is not a test.`);
        if (!DECISIONS.includes(input.decision)) throw refuse("decision", `A decision is ${DECISIONS.join(" or ")}.`);
        const r = t.fields.result;
        if (r !== "pass" && r !== "fail") throw refuse("not_solved", `${t.id} is ${String(r ?? "unsolved")}: decide once it has a result.`);
        const facts: Fact[] = [];
        for (const [k, v] of [["decision", input.decision], ["decided_version", t.fields.version ?? null]] as [string, Json][]) {
          if (t.fields[k] !== undefined) facts.push(["-", t.id, k, t.fields[k]!]);
          if (v !== null) facts.push(["+", t.id, k, v]);
        }
        call.write(facts);
        return { test: t.id, decision: input.decision, version: t.fields.version ?? null };
      },
    });

    register.register({
      name: "checks.rejections",
      title: "What people's decisions say about each rule",
      doc: "Per rule with decided tests: the findings people rejected and accepted at the test's version now, with their measured values, and the limit that would spare every rejection while still catching every acceptance (`proposal`, null when none does). Writes nothing: an agent reads it before proposing a rule change.",
      input: { type: "object", properties: { rule: { type: "string", description: "One rule's id; absent, every rule." } } },
      async run(input: { rule?: string }) {
        const limits: RuleLimit[] = [];
        for (const [, d] of domains) {
          if (!d.limits) continue;
          try {
            limits.push(...(await d.limits()));
          } catch (err) {
            throw refuse("limits", `The ${d.subject} domain couldn't say its rules' limits: ${(err as Error).message}`);
          }
        }
        const decided: Decided[] = [];
        for (const t of await every(graph, TEST)) {
          const d = decidedOf(t, (await read.links(t.id, APPLIES, "out"))[0]?.to);
          if (d) decided.push(d);
        }
        const rules = (await every(graph, RULE))
          .filter((r) => !input.rule || r.id === input.rule)
          .map((r) => ({ id: r.id, title: String(r.fields.title ?? r.id), fn: r.fields.fn as string | undefined, params: r.fields.params }));
        return readRejections(rules, limits, decided) as RuleReading[] as unknown as Json;
      },
    });

    // Solve passes run one at a time, in the order changes came.
    let queue: Promise<unknown> = Promise.resolve();
    let stopped = false;
    const write = async (w: Write) => {
      const out = await attest.invoke({ action: "checks.result", input: { test: w.test, fields: w.fields }, attest: { test: w.test, version: w.version }, reason: w.reason });
      if (!out.ok) throw new Error(`${out.refused.code}: ${out.refused.message}`);
    };
    const run = (ids: string[] | (() => Promise<string[]>)) => {
      if (stopped) return queue;
      queue = queue
        .then(async () => {
          const seeded = typeof ids === "function" ? await ids() : ids;
          if (seeded.length && !stopped) await solve(seeded, read, domainOf, write);
        })
        .catch((err) => ctx.runtime.report(ctx.fiber, err));
      return queue;
    };
    const typeOf = async (id: string) => (await graph.get([id]))[0]?.type;
    const stampOf = (type: string) => domains.get(type)?.stamp;
    const heard = (change: { header: { actor: { id: string } }; facts: Fact[] }) => {
      if (change.header.actor.id.startsWith(ATTESTED)) return; // the checker's own results
      run(() => seeds(change.facts, read, typeOf, stampOf));
    };
    watch.watch({ types: [TEST, RULE, ...TEST_LINKS] }, heard);

    ctx.provide<ChecksDomain>("checks.domain", (_caller, from) => ({
      register(domain): Dispose {
        if (!domain.subject || domain.subject === TEST || domain.subject === RULE) throw refuse("subject", `A domain's subject is a type of its own, not ${domain.subject || "nothing"}.`);
        if (!domain.stamp || (STAMP_KEYS as readonly string[]).includes(domain.stamp)) throw refuse("stamp", `A domain stamps a field of its subject other than ${STAMP_KEYS.join(", ")}.`);
        if (domains.has(domain.subject)) throw refuse("subject_taken", `${domain.subject} is already judged by another domain.`);
        return from.effect(() => {
          domains.set(domain.subject, domain);
          const unwatch = watch.watch({ types: [domain.subject] }, heard);
          // Catch up: every test whose stamp moved while nothing judged its subject.
          run(async () => (await every(graph, TEST)).map((t) => t.id));
          return () => {
            unwatch();
            if (domains.get(domain.subject) === domain) domains.delete(domain.subject);
          };
        });
      },
    }));
    ctx.effect(() => () => void (stopped = true));
  },
};

export default checks;
