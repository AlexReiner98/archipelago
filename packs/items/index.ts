/**
 * The items pack: the actions anyone edits the map with, a person through
 * a page or an agent through a tool. Generic: it reads what each type is
 * from types.read and knows bases and field kinds, never a type's name.
 *
 * - `items.create`: an item of a type, with its title and fields. Its
 *   status is its base's first open one unless given.
 * - `items.set`: fields of an item; `null` clears one.
 * - `items.link`: a link of a kind between two items.
 * - `items.unlink`: a link taken away.
 *
 * Each refuses what the types don't allow, saying what would pass. The
 * schema pack checks the same in the write chain, for writes from
 * anywhere; this checks early, so a refusal names the field.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import type { FieldDef, LinkInfo, TypeInfo, TypesRead } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `items.${code}`, message, by: { pack: "items" } });
};

export const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Whether a value fits a field's kind. `null` always does: it clears. */
export function fits(f: FieldDef, v: Json): boolean {
  if (v === null) return true;
  switch (f.kind) {
    case "text":
    case "id":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && !Number.isNaN(Date.parse(v));
    case "choice":
      return typeof v === "string" && (!f.values || f.values.includes(v));
    case "json":
      return true;
  }
}

const isLink = (t: TypeInfo | LinkInfo | undefined): t is LinkInfo => !!t && !("base" in t);

const items: Pack = {
  id: "items",
  about: "Makes, changes and links items on the map.",
  inject: ["action.register", "graph.read", "types.read"],
  apply(ctx: Context) {
    const register = ctx.get<ActionRegister>("action.register");
    const graph = ctx.get<GraphRead>("graph.read");
    const types = ctx.get<TypesRead>("types.read");

    const typeOf = (name: string): TypeInfo => {
      const t = types.get(name);
      if (!t || isLink(t)) {
        const known = types.all().types.map((x) => x.name).join(", ");
        return refuse("type_unknown", `There is no type ${name} now. Known: ${known || "none"}.`);
      }
      return t;
    };
    const one = async (id: Id): Promise<Item> => {
      const [item] = await graph.get([id]);
      return item ?? refuse("missing", `There is no item ${id}.`);
    };
    /** Facts that set `fields` on an item whose fields are now `now`. */
    const setFacts = (id: Id, t: TypeInfo, now: Record<string, Json>, fields: Record<string, Json>): Fact[] => {
      const facts: Fact[] = [];
      for (const [k, v] of Object.entries(fields)) {
        if (k === "type" || k === "from" || k === "to") refuse("field_fixed", `${k} can't be set; make a new item instead.`);
        const f = t.fields[k];
        if (!f) refuse("field_unknown", `${t.name} has no field ${k}. It has: ${Object.keys(t.fields).join(", ")}.`);
        if (k === "status") {
          const all = [...t.statuses.open, ...t.statuses.closed];
          if (v === null || !all.includes(String(v))) refuse("status", `${t.name}'s statuses are ${all.join(", ")}.`);
        } else if (!fits(f!, v)) {
          refuse("field_kind", `${t.name}.${k} takes ${f!.kind === "choice" ? `one of ${f!.values!.join(", ")}` : `a ${f!.kind}`}.`);
        }
        if (k === "title" && (typeof v !== "string" || !v.trim())) refuse("title", "A title can't be empty.");
        const old = now[k];
        if (JSON.stringify(old) === JSON.stringify(v ?? undefined)) continue;
        if (old !== undefined) facts.push(["-", id, k, old]);
        if (v !== null) facts.push(["+", id, k, v]);
      }
      return facts;
    };
    /** `made`: items this same call makes, not on the graph yet, by id → type. */
    const linkFacts = async (kind: string, from: Id, to: Id, fields: Record<string, Json> = {}, made: Record<Id, string> = {}): Promise<{ id: Id; facts: Fact[] }> => {
      const l = types.get(kind);
      if (!isLink(l)) {
        const known = types.all().links.map((x) => x.name).join(", ");
        return refuse("link_unknown", `There is no kind of link ${kind} now. Known: ${known || "none"}.`);
      }
      if (from === to) refuse("link_self", "An item can't be linked to itself.");
      const [a, b] = await graph.get([from, to]);
      const typeAt = (id: Id, item: Item | null | undefined) => made[id] ?? (item && typeof item.fields.from !== "string" ? item.type : undefined);
      for (const [end, id, item, allowed] of [["from", from, a, l.from], ["to", to, b, l.to]] as const) {
        const type = typeAt(id, item);
        if (!type) return refuse("missing", `There is no item ${id} to link ${end}.`);
        const t = types.get(type);
        if (allowed && (!t || isLink(t) || !allowed.includes(t.base))) refuse("link_end", `${kind} goes ${end} ${allowed.join(" or ")}, not ${type}.`);
      }
      const id = newId();
      const facts: Fact[] = [["+", id, "type", kind], ["+", id, "from", from], ["+", id, "to", to]];
      for (const [k, v] of Object.entries(fields)) {
        const f = l.fields?.[k];
        if (!f) refuse("field_unknown", `${kind} has no field ${k}.`);
        if (!fits(f!, v)) refuse("field_kind", `${kind}.${k} takes a ${f!.kind}.`);
        if (v !== null) facts.push(["+", id, k, v]);
      }
      return { id, facts };
    };

    register.register({
      name: "items.create",
      title: "Make an item",
      input: {
        type: "object",
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          fields: { type: "object", description: "Its other fields; status defaults to its base's first open one." },
          part_of: { type: "string", description: "An item it is part of, linked in the same change." },
        },
        required: ["type", "title"],
      },
      async run(input: { type: string; title: string; fields?: Record<string, Json>; part_of?: Id }, call: ActionContext) {
        const t = typeOf(input.type);
        const id = newId();
        const fields = { status: t.statuses.open[0]!, ...(input.fields ?? {}), title: input.title };
        call.write([["+", id, "type", t.name], ...setFacts(id, t, {}, fields)]);
        if (input.part_of) call.write((await linkFacts("part_of", id, input.part_of, {}, { [id]: t.name })).facts);
        return { id };
      },
    });

    register.register({
      name: "items.set",
      title: "Change an item's fields",
      input: {
        type: "object",
        properties: { id: { type: "string" }, fields: { type: "object", description: "Field → value; null clears it." } },
        required: ["id", "fields"],
      },
      async run(input: { id: Id; fields: Record<string, Json> }, call: ActionContext) {
        const item = await one(input.id);
        const t = types.get(item.type);
        if (isLink(t)) {
          const facts: Fact[] = [];
          for (const [k, v] of Object.entries(input.fields)) {
            const f = t.fields?.[k];
            if (!f) refuse("field_unknown", `${t.name} has no field ${k}.`);
            if (!fits(f!, v)) refuse("field_kind", `${t.name}.${k} takes a ${f!.kind}.`);
            const old = item.fields[k];
            if (old !== undefined) facts.push(["-", item.id, k, old]);
            if (v !== null) facts.push(["+", item.id, k, v]);
          }
          call.write(facts);
          return { id: item.id };
        }
        call.write(setFacts(item.id, typeOf(item.type), item.fields, input.fields));
        return { id: item.id };
      },
    });

    register.register({
      name: "items.link",
      title: "Link two items",
      input: {
        type: "object",
        properties: { type: { type: "string" }, from: { type: "string" }, to: { type: "string" }, fields: { type: "object" } },
        required: ["type", "from", "to"],
      },
      async run(input: { type: string; from: Id; to: Id; fields?: Record<string, Json> }, call: ActionContext) {
        const { id, facts } = await linkFacts(input.type, input.from, input.to, input.fields);
        call.write(facts);
        return { id };
      },
    });

    register.register({
      name: "items.unlink",
      title: "Take a link away",
      input: { type: "object", properties: { id: { type: "string", description: "The link's id" } }, required: ["id"] },
      async run(input: { id: Id }, call: ActionContext) {
        const item = await one(input.id);
        if (typeof item.fields.from !== "string") refuse("not_a_link", `${input.id} is an item, not a link: drop it by its status.`);
        const facts: Fact[] = [["-", item.id, "type", item.type]];
        for (const [k, v] of Object.entries(item.fields)) facts.push(["-", item.id, k, v]);
        call.write(facts);
        return { id: item.id };
      },
    });
  },
};

export default items;
