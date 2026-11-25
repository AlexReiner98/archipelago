/**
 * The schema plugin: a check stage on the write chain (spec/graph.md). Before
 * calling `next`, it checks each change set against the types defined now
 * (`types.read`, spec/types.md; check.ts). A set that doesn't fit is
 * refused whole and quarantined (quarantine.ts): kept with what was wrong,
 * seen through `schema.quarantined`, sent again through `schema.release`,
 * neither dropped nor applied on its own. Node only.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphStage } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { TypesAcyclic, TypesRead } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { after, check, type Fields } from "./check.ts";
import { cycles, type Edge } from "./cycle.ts";
import { Quarantine, type State } from "./quarantine.ts";

export { check } from "./check.ts";

export interface SchemaConfig {
  /** The SQLite database quarantined sets are kept in. None: in memory. */
  db?: string;
  /** Refuse items of a type nobody defines. Default false: they pass unchecked. */
  strict?: boolean;
}

const by = { plugin: "schema" };
const RELEASE = "schema.release";

const schema: Plugin<SchemaConfig> = {
  id: "schema",
  about: "Checks every change against the kinds of item, and holds back what doesn't fit.",
  inject: ["graph.stage", "graph.read", "types.read", "types.acyclic", "action.register"],
  async apply(ctx: Context, config: SchemaConfig = {}) {
    if (config.db) {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.db), { recursive: true });
    }
    const graph = ctx.get<GraphRead>("graph.read");
    const types = ctx.get<TypesRead>("types.read");
    const acyclic = ctx.get<TypesAcyclic>("types.acyclic");
    /** Links of a kind going out of an item, every page. */
    const out = async (id: Id, kind: string): Promise<Edge[]> => {
      const edges: Edge[] = [];
      let after: string | undefined;
      do {
        const page = await graph.links(id, { type: kind, dir: "out" }, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
        for (const l of page.items) if (l.from === id) edges.push({ id: l.id, from: l.from, to: l.to });
        after = page.next;
      } while (after);
      return edges;
    };
    const quarantine = new Quarantine(config.db);
    ctx.effect(() => () => quarantine.close());
    /** Releases in flight, by their facts, so the stage can mark each applied once it is. */
    const releasing = new Map<string, string>();

    const problemsOf = async (facts: readonly Fact[]) => {
      const ids = [...new Set(facts.map((f) => f[1]))];
      const now = new Map<Id, Fields>();
      const known = new Map<Id, string | null>();
      const read = async (want: Id[]) => {
        for (let i = 0; i < want.length; i += LIMIT_MAX) {
          const items = await graph.get(want.slice(i, i + LIMIT_MAX));
          want.slice(i, i + LIMIT_MAX).forEach((id, k) => known.set(id, items[k]?.type ?? null));
          for (const item of items) if (item) now.set(item.id, { type: item.type, ...item.fields });
        }
      };
      await read(ids);
      // Items named by `id` fields and link ends, outside the set: read them too. An item checked whole (made, or
      // given a new type) is checked with the ends and ids it already had, so those are read as well.
      const named = new Set<Id>();
      const name = (value: Json | undefined) => {
        if (typeof value === "string" && !known.has(value) && value.length <= 200) named.add(value);
      };
      for (const [op, , , value] of facts) if (op === "+") name(value);
      for (const fields of now.values()) for (const value of Object.values(fields)) name(value);
      await read([...named]);
      const problems = check(now, facts, {
        type: (name) => types.get(name),
        typeOf: (id) => known.get(id) ?? null,
        strict: config.strict ?? false,
      });
      if (!problems.length) problems.push(...(await cycles(after(now, facts), new Set(acyclic.held()), out)));
      return { problems, now };
    };

    /** The type each id has once the facts apply: the last type asserted, else what it had. */
    const typeAfter = (facts: readonly Fact[], now: Map<Id, Fields>, id: Id): string | undefined => {
      let t = typeof now.get(id)?.type === "string" ? (now.get(id)!.type as string) : undefined;
      for (const [op, fid, field, value] of facts) if (fid === id && field === "type") t = op === "+" ? String(value) : undefined;
      return t;
    };

    ctx.get<GraphStage>("graph.stage").stage(async (change, next) => {
      const { problems, now } = await problemsOf(change.facts);
      const key = change.header.action === RELEASE ? JSON.stringify(change.facts) : undefined;
      const releases = key !== undefined ? releasing.get(key) : undefined;
      if (releases) releasing.delete(key!);
      if (problems.length) {
        const list = problems.map((p) => p.message).join(" ");
        if (releases) {
          throw new Refused({ code: "schema.misfit", message: `${releases} still doesn't fit, so it stays held: ${list}`, by, detail: problems as unknown as Json });
        }
        const held = quarantine.hold(change, problems);
        quarantine.missed(problems.map((p) => typeAfter(change.facts, now, p.id)).filter((t): t is string => !!t), held.at);
        throw new Refused({
          code: "schema.quarantined",
          message: `This change doesn't fit the types defined now, so it is held as ${held.id}, not applied: ${list} Send a change that fits, or schema.release ${held.id} once its types allow it.`,
          by,
          detail: { quarantine: held.id, problems: problems as unknown as Json },
        });
      }
      const committed = await next(change);
      if (releases) quarantine.released(releases, committed.id);
      // What each type is made of: an item new to the graph, or given a new type.
      const made = change.facts.filter(([op, id, field, value]) => op === "+" && field === "type" && now.get(id)?.type !== value).map((f) => String(f[3]));
      try {
        quarantine.made(made, committed.committed);
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
      }
      return committed;
    });

    const register = ctx.get<ActionRegister>("action.register");

    register.register({
      name: "schema.quarantined",
      title: "Change sets held because they didn't fit",
      doc: "Newest first, each with its header, facts and what was wrong. `state` narrows to held, released or dropped. Writes nothing.",
      input: {
        type: "object",
        properties: {
          state: { enum: ["held", "released", "dropped"] },
          limit: { type: "number" },
          after: { type: "string" },
        },
      },
      async run(input: { state?: State; limit?: number; after?: string }) {
        return quarantine.list(input.state, { limit: input.limit, after: input.after }) as unknown as Json;
      },
    });

    register.register({
      name: RELEASE,
      title: "Send a held change set again",
      doc: "Writes the held set's facts again, as a change by whoever releases it. Applied if it fits now (its types defined since, say), and marked released; refused with schema.misfit if not, and it stays held.",
      input: { type: "object", properties: { quarantine: { type: "string", description: "q<n>" } }, required: ["quarantine"] },
      async run(input: { quarantine: string }, call: ActionContext) {
        const held = quarantine.get(input.quarantine);
        if (!held) throw new Refused({ code: "schema.unknown", message: `Nothing is held as ${input.quarantine}.`, by });
        if (held.state !== "held") throw new Refused({ code: "schema.not_held", message: `${input.quarantine} is ${held.state}, not held.`, by });
        const key = JSON.stringify(held.change.facts);
        // The stage takes it back when the set comes down the chain, applied or not.
        releasing.set(key, held.id);
        call.write(held.change.facts);
        return { quarantine: held.id, facts: held.change.facts.length } as Json;
      },
    });

    register.register({
      name: "schema.drop",
      title: "Stop holding a change set",
      doc: "Marks a held set dropped, with why. It is never applied; the record stays.",
      input: { type: "object", properties: { quarantine: { type: "string" } }, required: ["quarantine"] },
      async run(input: { quarantine: string }, call: ActionContext) {
        const held = quarantine.get(input.quarantine);
        if (!held) throw new Refused({ code: "schema.unknown", message: `Nothing is held as ${input.quarantine}.`, by });
        if (held.state !== "held") throw new Refused({ code: "schema.not_held", message: `${input.quarantine} is ${held.state}, not held.`, by });
        quarantine.dropped(held.id, call.reason, call.caller.actor?.id ?? `plugin:${call.caller.plugin}`);
        return { quarantine: held.id, state: "dropped" } as Json;
      },
    });

    register.register({
      name: "schema.record",
      title: "Each type's record: what is made of it, and the misses it causes",
      doc: "Per type, defined or not: items made (new, or given the type), sets held because an item of it didn't fit, and when each last happened, with whether the type is a trial flavour. What the learning loop keeps or makes dormant a type by. Writes nothing.",
      input: { type: "object", properties: { type: { type: "string" } } },
      async run(input: { type?: string }) {
        const defined = types.all().types;
        const rows = new Map(quarantine.record().map((r) => [r.type, r]));
        for (const t of defined) if (!rows.has(t.name)) rows.set(t.name, { type: t.name, made: 0, misses: 0 });
        const out = [...rows.values()]
          .filter((r) => !input.type || r.type === input.type)
          .map((r) => {
            const t = types.get(r.type);
            const info = t && "statuses" in t ? { base: t.base, trial: t.trial } : t ? { link: true } : { defined: false };
            return { ...r, ...info };
          });
        return out as unknown as Json;
      },
    });

    register.register({
      name: "schema.check",
      title: "Would these facts fit?",
      doc: "Checks facts against the types defined now, without writing or holding anything.",
      input: { type: "object", properties: { facts: { type: "array" } }, required: ["facts"] },
      async run(input: { facts: Fact[] }) {
        const { problems } = await problemsOf(input.facts);
        return { fits: problems.length === 0, problems } as unknown as Json;
      },
    });
  },
};

export default schema;
