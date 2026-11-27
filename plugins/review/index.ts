/**
 * The review plugin, server side: issues raised about items on the map,
 * by a person, an agent, or a check of what something measured.
 *
 * An issue is a `question` of kind `review`, linked `about` each item it is
 * raised on: open until decided (fixed, or accepted as it is) or dropped.
 * No type of its own: the bases already say what an issue is.
 *
 * `review.check` reads any record whose `value.items` maps item ids to a
 * measured share (a solve's worst gap per beam, say). It raises an issue on
 * each item over the limit that has none open, and decides the ones it
 * raised before on items now within it. The record `bears_on` each issue it
 * raised or decided: the evidence, kept with the question. It knows no
 * other plugin: what it reads is a shape of record, not a type's name.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

/** An issue is a question of this kind. */
export const REVIEW = "review";
/** Over this share, `review.check` raises an issue (5%). */
export const OVER = 0.05;

const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `review.${code}`, message, by: { plugin: "review" } });
};

const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);
const isObj = (v: Json | undefined): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const link = (type: string, from: Id, to: Id): Fact[] => {
  const id = newId();
  return [["+", id, "type", type], ["+", id, "from", from], ["+", id, "to", to]];
};

/** An issue as `review.of` answers it. */
export interface Issue {
  id: Id;
  title: string;
  note?: string;
  status: string;
  about: Id[];
  /** Raised or decided by a check of a measuring record. */
  measured: boolean;
}

/** The facts that raise an issue about items. */
export function raise(title: string, about: Id[], note?: string): { id: Id; facts: Fact[] } {
  const id = newId();
  const facts: Fact[] = [["+", id, "type", "question"], ["+", id, "status", "open"], ["+", id, "title", title], ["+", id, "kind", REVIEW]];
  if (note) facts.push(["+", id, "note", note]);
  for (const a of about) facts.push(...link("about", id, a));
  return { id, facts };
}

const review: Plugin = {
  id: "review",
  about: "Review: issues raised about items on the map, by hand or by checking what a record measured, each a question until decided.",
  inject: ["action.register", "graph.read"],
  apply(ctx: Context) {
    const register = ctx.get<ActionRegister>("action.register");
    const graph = ctx.get<GraphRead>("graph.read");

    /** Review issues about one item, open first. */
    const issuesAbout = async (item: Id): Promise<Item[]> => {
      const about = await graph.links(item, { type: "about", dir: "in" }, { limit: LIMIT_MAX });
      const got = await graph.get(about.items.map((l) => l.from));
      return got.filter((q): q is Item => !!q && q.type === "question" && q.fields.kind === REVIEW);
    };
    /** Whether a measuring record bears on the issue. */
    const measured = async (issue: Id): Promise<boolean> => {
      const bears = await graph.links(issue, { type: "bears_on", dir: "in" }, { limit: LIMIT_MAX });
      const from = await graph.get(bears.items.map((l) => l.from));
      return from.some((r) => !!r && r.type === "record" && isObj(r.fields.value) && isObj(r.fields.value.items));
    };
    const issue = async (q: Item): Promise<Issue> => {
      const about = await graph.links(q.id, { type: "about", dir: "out" }, { limit: LIMIT_MAX });
      return {
        id: q.id,
        title: String(q.fields.title ?? q.id),
        ...(typeof q.fields.note === "string" ? { note: q.fields.note } : {}),
        status: String(q.fields.status),
        about: about.items.map((l) => l.to),
        measured: await measured(q.id),
      };
    };

    register.register({
      name: "review.raise",
      title: "Raise a review issue about items",
      input: {
        type: "object",
        properties: {
          title: { type: "string", description: "The issue in a few words." },
          about: { type: "array", items: { type: "string" }, minItems: 1, description: "The items it is about." },
          note: { type: "string", description: "What else there is to say." },
        },
        required: ["title", "about"],
      },
      async run(input: { title: string; about: Id[]; note?: string }, call: ActionContext) {
        if (input.about.length > LIMIT_MAX) refuse("about", `At most ${LIMIT_MAX} items.`);
        const got = await graph.get(input.about);
        got.forEach((x, i) => x || refuse("missing", `There is no item ${input.about[i]}.`));
        const { id, facts } = raise(input.title, input.about, input.note);
        call.write(facts);
        return { issue: id };
      },
    });

    register.register({
      name: "review.of",
      title: "Review issues about items",
      input: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" }, description: "The items; each one's parts are read too." },
          open: { type: "boolean", description: "Only open issues (default true)." },
        },
        required: ["items"],
      },
      async run(input: { items: Id[]; open?: boolean }) {
        const ids = new Set<Id>();
        for (const it of input.items.slice(0, 50)) {
          ids.add(it);
          const parts = await graph.links(it, { type: "part_of", dir: "in" }, { limit: LIMIT_MAX });
          for (const p of parts.items) ids.add(p.from);
        }
        const seen = new Map<Id, Item>();
        for (const id of ids) for (const q of await issuesAbout(id)) seen.set(q.id, q);
        const list = [...seen.values()].filter((q) => input.open === false || q.fields.status === "open");
        // What a check could read: current measuring records about the items, or about what they are part of.
        const near = new Set<Id>(input.items.slice(0, 50));
        for (const it of input.items.slice(0, 50)) for (const l of (await graph.links(it, { type: "part_of", dir: "out" }, { limit: 20 })).items) near.add(l.to);
        const measures: { id: Id; title: string }[] = [];
        for (const it of near) {
          const about = await graph.links(it, { type: "about", dir: "in" }, { limit: LIMIT_MAX });
          for (const r of await graph.get(about.items.map((l) => l.from)))
            if (r && r.type === "record" && r.fields.status === "current" && isObj(r.fields.value) && isObj(r.fields.value.items)) measures.push({ id: r.id, title: String(r.fields.title ?? r.id) });
        }
        return { issues: (await Promise.all(list.map(issue))) as unknown as Json, measures };
      },
    });

    register.register({
      name: "review.check",
      title: "Check what a record measured, raising and deciding issues",
      input: {
        type: "object",
        properties: {
          record: { type: "string", description: "A record whose value.items maps item ids to a measured share." },
          over: { type: "number", minimum: 0, description: `Raise an issue where the share is over this (default ${OVER}).` },
        },
        required: ["record"],
      },
      async run(input: { record: Id; over?: number }, call: ActionContext) {
        const over = input.over ?? OVER;
        const [rec] = await graph.get([input.record]);
        if (!rec) return refuse("missing", `There is no item ${input.record}.`);
        const value = rec.fields.value;
        if (rec.type !== "record" || !isObj(value) || !isObj(value.items))
          return refuse("not_measured", `${input.record} measures nothing to check: a record whose value.items maps item ids to a share.`);
        const items = Object.entries(value.items).filter((e): e is [Id, number] => typeof e[1] === "number").slice(0, LIMIT_MAX);
        const named = await graph.get(items.map(([id]) => id));
        const facts: Fact[] = [];
        const raised: Id[] = [], decided: Id[] = [];
        for (const [k, [id, share]] of items.entries()) {
          const it = named[k];
          if (!it) continue;
          const open = (await issuesAbout(id)).filter((q) => q.fields.status === "open");
          const name = String(it.fields.title ?? id);
          if (share > over) {
            if (open.length) continue;
            const r = raise(`${name}: gap ${pct(share)}`, [id], `Measured ${pct(share)} in ${String(rec.fields.title ?? rec.id)}, over ${pct(over)}.`);
            facts.push(...r.facts, ...link("bears_on", rec.id, r.id));
            raised.push(r.id);
          } else {
            for (const q of open) {
              if (!(await measured(q.id))) continue;
              facts.push(
                ["-", q.id, "status", "open"],
                ["+", q.id, "status", "decided"],
                ["+", q.id, "outcome", `Within ${pct(over)}: ${pct(share)}`],
                ["+", q.id, "decided_on", today()],
                ...link("bears_on", rec.id, q.id),
              );
              decided.push(q.id);
            }
          }
        }
        call.write(facts);
        return { raised, decided, over };
      },
    });
  },
};

export default review;
