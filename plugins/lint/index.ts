/**
 * Map lint: rules over the map's own items, judged by the functions in
 * rules.ts, as a checks domain. It needs no service: each function reads
 * the item it checks (and what it needs around it) through the checks
 * plugin's tracked reader, so a test is solved again exactly when something
 * it read moves. The rules are map items (`rule`, `fn: lint.*`, `params`);
 * `lint.cover` makes a rule's tests over the items of a type.
 */
import type { ActionRegister } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { Fact } from "../../spec/changeset.ts";
import { LIMIT_MAX, type GraphRead } from "../../spec/graph.ts";
import type { TypesRead } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { ChecksDomain } from "../checks/index.ts";
import { APPLIES, CHECKS, RULE, TEST } from "../checks/types.ts";
import { FNS, finding } from "./rules.ts";

export { FNS, finding } from "./rules.ts";

const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `lint.${code}`, message, by: { plugin: "lint" } });
};
const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const lint: Plugin = {
  id: "lint",
  about: "Map lint: rules over the map's own items (an owner, a hub, not overdue), judged by local functions as a checks domain.",
  inject: ["checks.domain", "action.register", "graph.read", "types.read"],
  apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    const types = ctx.get<TypesRead>("types.read");
    const byName = new Map(FNS.map((f) => [f.name, f]));
    ctx.get<ChecksDomain>("checks.domain").register({
      fns: FNS.map((f) => f.name),
      judge: (call) => byName.get(call.fn)!.judge(call),
      finding,
      limits: async () => FNS.flatMap((f) => (f.limit ? [{ fn: f.name, ...f.limit }] : [])),
    });

    ctx.get<ActionRegister>("action.register").register({
      name: "lint.cover",
      title: "Make a lint rule's tests",
      doc: `A test of the rule for each item of \`type\` that has none yet, one page at a time (at most ${LIMIT_MAX}): pass \`next\` back as \`after\` for the next page. The functions: ${FNS.map((f) => `${f.name} (${f.doc})`).join(" ")}`,
      input: {
        type: "object",
        properties: {
          rule: { type: "string" },
          type: { type: "string", description: "The type of the items to test." },
          limit: { type: "integer", minimum: 1, maximum: LIMIT_MAX },
          after: { type: "string" },
        },
        required: ["rule", "type"],
      },
      async run(input: { rule: string; type: string; limit?: number; after?: string }, call) {
        const [rule] = await graph.get([input.rule]);
        if (!rule || rule.type !== RULE) return refuse("not_a_rule", `${input.rule} is not a rule.`);
        if (typeof rule.fields.fn !== "string" || !byName.has(rule.fields.fn)) refuse("not_lint", `${rule.id}'s fn is not one of lint's: ${FNS.map((f) => f.name).join(", ")}.`);
        const test = types.get(TEST);
        if (!test || !("base" in test)) return refuse("no_checks", "The checks plugin isn't loaded.");
        const limit = Math.min(input.limit ?? 100, LIMIT_MAX);
        const page = await graph.of(input.type, { limit, ...(input.after ? { after: input.after } : {}) });
        // Items already tested by this rule: the rule's tests, a page at a time, and what each checks.
        const tested = new Set<string>();
        let after: string | undefined;
        do {
          const p = await graph.links(rule.id, { type: APPLIES, dir: "in" }, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
          for (const l of p.items) {
            const c = await graph.links(l.from, { type: CHECKS, dir: "out" }, { limit: 1 });
            if (c.items[0]) tested.add(c.items[0].to);
          }
          after = p.next;
        } while (after);
        const facts: Fact[] = [];
        const made: string[] = [];
        for (const it of page.items) {
          if (tested.has(it.id) || typeof it.fields.from === "string") continue;
          const id = newId();
          made.push(id);
          const title = `${String(rule.fields.title ?? rule.id)}: ${String(it.fields.title ?? it.id)}`;
          facts.push(["+", id, "type", TEST], ["+", id, "status", test.statuses.open[0]!], ["+", id, "title", title]);
          for (const [kind, to] of [[CHECKS, it.id], [APPLIES, rule.id]] as const) {
            const l = newId();
            facts.push(["+", l, "type", kind], ["+", l, "from", id], ["+", l, "to", to]);
          }
        }
        if (facts.length) call.write(facts);
        return { made, ...(page.next ? { next: page.next } : {}) } as Json;
      },
    });
  },
};

export default lint;
