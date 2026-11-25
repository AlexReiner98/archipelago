/**
 * What a typed call holds a model to, and what it makes of the answer. Pure:
 * no runtime, no graph.
 *
 * - `schemaOf`: a JSON Schema for a reply of items of one type, built from
 *   the type as `types.read` resolves it (a base, or a flavour with its
 *   base's fields and statuses) and the kinds of link that may go out of it.
 *   Nothing is written per type.
 * - `factsOf`: a reply turned into the facts that would make those items and
 *   their links, with the shape problems that stop it (not an object, no
 *   title, a ref used twice). Whether the facts fit the map is the schema
 *   pack's to say (`schema.check`), not this file's.
 * - `strictSubset`: the schema as providers' strict modes take it (every
 *   property required, optional ones nullable), an optimization only.
 */
import type { JsonSchema } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { FieldDef, LinkInfo, TypeInfo } from "../../spec/types.ts";

/** The fields a reply's item carries besides the type's own: its name in the reply, and its links. */
export const REF = "ref";
export const LINKS = "links";

export interface ShapeOptions {
  /** Kinds of link the model may give each item, going out of it. Absent: every kind whose `from` allows the type's base. `[]`: none. */
  links?: string[];
  /** How many items: at least, at most. */
  min?: number;
  max?: number;
  /** Only these of the type's fields are offered to the model; the caller fills the rest (`set`). Absent: every field. */
  fields?: string[];
}

export interface ShapeProblem {
  code: string;
  message: string;
  /** Where in the reply: `items[2].title`. */
  at?: string;
}

/** The kinds of link that may go out of an item of base `base`: `from` absent or naming it. Narrowed to `only` when given. */
export function linksFrom(links: LinkInfo[], base: string, only?: string[]): LinkInfo[] {
  return links.filter((l) => (!l.from?.length || l.from.includes(base)) && (!only || only.includes(l.name)));
}

/** A field's JSON Schema, by its kind. */
export function fieldSchema(def: FieldDef): JsonSchema {
  const doc: JsonSchema = def.doc ? { description: def.doc } : {};
  switch (def.kind) {
    case "text":
      return { type: "string", ...doc };
    case "number":
      return { type: "number", ...doc };
    case "boolean":
      return { type: "boolean", ...doc };
    case "date":
      return { type: "string", description: `${def.doc ? `${def.doc} ` : ""}A date, ISO 8601.` };
    case "id":
      return { type: "string", description: `${def.doc ? `${def.doc} ` : ""}An existing item's id.` };
    case "choice":
      return def.values?.length ? { type: "string", enum: def.values, ...doc } : { type: "string", ...doc };
    case "json":
    default:
      return { ...doc };
  }
}

/** A reply of items of type `t`: `{ items: [{ ref, title, …fields, links: [{ type, to }] }] }`. */
export function schemaOf(t: TypeInfo, links: LinkInfo[], opts: ShapeOptions = {}): JsonSchema {
  const props: Record<string, JsonSchema> = {
    [REF]: { type: "string", description: "A short name for this item, unique in the reply: other items' links may name it." },
  };
  for (const [name, def] of Object.entries(t.fields)) {
    if (opts.fields && !opts.fields.includes(name)) continue;
    if (name === "status") {
      props.status = { type: "string", enum: [...t.statuses.open, ...t.statuses.closed], description: `Absent: ${t.statuses.open[0]}.` };
      continue;
    }
    props[name] = fieldSchema(def);
  }
  const kinds = linksFrom(links, t.base, opts.links);
  if (kinds.length) {
    const doc = kinds.map((l) => `${l.name}${l.to?.length ? ` (to a ${l.to.join(" or ")})` : ""}${l.doc ? `: ${l.doc}` : ""}`).join("; ");
    props[LINKS] = {
      type: "array",
      description: `Links going out of this item. ${doc}`,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: kinds.map((l) => l.name) },
          to: { type: "string", description: "An existing item's id, or another item's ref in this reply." },
        },
        required: ["type", "to"],
        additionalProperties: false,
      },
    };
  }
  const items: JsonSchema = { type: "array", items: { type: "object", properties: props, required: "title" in props ? [REF, "title"] : [REF], additionalProperties: false } };
  if (opts.min !== undefined) items.minItems = opts.min;
  if (opts.max !== undefined) items.maxItems = opts.max;
  return {
    type: "object",
    title: t.name,
    description: `Items of type ${t.name}${t.base !== t.name ? `, a ${t.base}` : ""}${t.doc ? `: ${t.doc}` : "."}`,
    properties: { items },
    required: ["items"],
    additionalProperties: false,
  };
}

/**
 * The schema as providers' strict modes take it: every object's properties
 * all required and closed, an optional one nullable instead. A null in a
 * reply means absent (`factsOf` drops it).
 */
export function strictSubset(schema: JsonSchema): JsonSchema {
  const walk = (s: Json): Json => {
    if (Array.isArray(s)) return s.map(walk);
    if (!s || typeof s !== "object") return s;
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(s)) out[k] = k === "properties" ? v : walk(v);
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      const props = out.properties as Record<string, Json>;
      const required = new Set((out.required as string[] | undefined) ?? []);
      const next: Record<string, Json> = {};
      for (const [k, v] of Object.entries(props)) {
        const w = walk(v) as Record<string, Json>;
        next[k] = required.has(k) ? w : { anyOf: [w, { type: "null" }] };
      }
      out.properties = next;
      out.required = Object.keys(next);
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(schema) as JsonSchema;
}

export interface Made {
  /** The facts that make the items and their links, in reply order. */
  facts: Fact[];
  /** Each item's ref → the id it is given. */
  ids: Record<string, Id>;
  /** Each made id → where in the reply it came from (`item "a"`, `item "a"'s link 2`), to say problems in the model's words. */
  names: Record<Id, string>;
  problems: ShapeProblem[];
}

const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The facts a reply would write: each item of type `t` (its base's first
 * open status when it gives none), each link going out of it (`to` a ref in
 * the reply, else taken as an id), and the links the caller adds to every
 * item (`attach`), and the fields it sets on every item (`set`, over the
 * reply's). With `fields`, a field the model wasn't offered is a problem. A
 * null field is absent. Ids come from `newId`.
 */
export function factsOf(reply: unknown, t: TypeInfo, newId: () => Id, opts: ShapeOptions & { attach?: { type: string; to: Id }[]; set?: Record<string, Json> } = {}): Made {
  const set = opts.set ?? {};
  const offered = (k: string) => !opts.fields || opts.fields.includes(k);
  const made: Made = { facts: [], ids: {}, names: {}, problems: [] };
  const problem = (code: string, message: string, at?: string) => made.problems.push({ code, message, ...(at ? { at } : {}) });
  const items = isObj(reply) ? reply.items : undefined;
  if (!Array.isArray(items)) {
    problem("typed.shape", "The reply is an object with `items`, an array.", "items");
    return made;
  }
  if (opts.min !== undefined && items.length < opts.min) problem("typed.count", `Give at least ${opts.min} items, not ${items.length}.`, "items");
  if (opts.max !== undefined && items.length > opts.max) problem("typed.count", `Give at most ${opts.max} items, not ${items.length}.`, "items");
  // Refs first, so a link may name an item that comes later.
  items.forEach((item, i) => {
    if (!isObj(item)) return;
    const ref = typeof item[REF] === "string" && item[REF] ? (item[REF] as string) : `#${i + 1}`;
    if (made.ids[ref]) problem("typed.ref", `Two items have the ref ${JSON.stringify(ref)}: each needs its own.`, `items[${i}].ref`);
    else made.ids[ref] = newId();
  });
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const at = `items[${i}]`;
    if (!isObj(item)) {
      problem("typed.shape", `${at} is an object.`, at);
      return;
    }
    const ref = typeof item[REF] === "string" && item[REF] ? (item[REF] as string) : `#${i + 1}`;
    if (seen.has(ref)) return;
    seen.add(ref);
    const id = made.ids[ref]!;
    made.names[id] = `item ${JSON.stringify(ref)}`;
    const title = set.title ?? item.title;
    if (typeof title !== "string" || !title.trim()) problem("typed.shape", `item ${JSON.stringify(ref)} needs a title.`, `${at}.title`);
    made.facts.push(["+", id, "type", t.name]);
    if ((item.status === undefined || item.status === null) && (set.status === undefined || set.status === null)) made.facts.push(["+", id, "status", t.statuses.open[0]!]);
    for (const [k, v] of Object.entries(item)) {
      if (k === REF || k === LINKS || v === null || k in set) continue;
      if (k === "type") {
        problem("typed.shape", `item ${JSON.stringify(ref)} has no field type: every item here is a ${t.name}.`, `${at}.type`);
        continue;
      }
      if (!offered(k)) {
        problem("typed.shape", `item ${JSON.stringify(ref)} has no field ${k} here: give only the fields in the schema.`, `${at}.${k}`);
        continue;
      }
      made.facts.push(["+", id, k, v]);
    }
    for (const [k, v] of Object.entries(set)) if (v !== null) made.facts.push(["+", id, k, v]);
    const out = [...(Array.isArray(item[LINKS]) ? (item[LINKS] as Json[]) : []), ...(opts.attach ?? [])];
    if (item[LINKS] !== undefined && item[LINKS] !== null && !Array.isArray(item[LINKS])) problem("typed.shape", `item ${JSON.stringify(ref)}'s links are an array.`, `${at}.links`);
    out.forEach((l, k) => {
      if (!isObj(l) || typeof l.type !== "string" || typeof l.to !== "string") {
        problem("typed.shape", `item ${JSON.stringify(ref)}'s link ${k + 1} is { type, to }.`, `${at}.links[${k}]`);
        return;
      }
      const lid = newId();
      made.names[lid] = `item ${JSON.stringify(ref)}'s ${l.type} link ${k + 1}`;
      made.facts.push(["+", lid, "type", l.type], ["+", lid, "from", id], ["+", lid, "to", made.ids[l.to] ?? l.to]);
    });
  });
  return made;
}

/** A problem's words with the ids made here said as the reply names them, so the model can find what to change. */
export function inReplyWords(message: string, names: Record<Id, string>): string {
  let out = message;
  for (const [id, name] of Object.entries(names)) out = out.split(id).join(name);
  return out;
}
