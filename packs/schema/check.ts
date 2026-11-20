/**
 * Whether a change set fits the types defined now (spec/types.md). Pure:
 * given the touched items as they are, the facts, and a way to look up
 * types and other items, it lists what doesn't fit.
 *
 * - An item made, or given a new type, is checked whole; otherwise only the
 *   fields the set asserts are.
 * - A field is checked by its kind; `status` against its base's statuses;
 *   an `id` field and a link's ends must name items that exist after the
 *   set, and a link's ends must be of the bases it allows.
 * - A type nobody defines passes unless `strict`.
 */
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { FieldDef, LinkInfo, TypeInfo } from "../../spec/types.ts";

export type Fields = Record<string, Json>;

export interface Problem {
  code: string;
  message: string;
  id: Id;
  field?: string;
}

export interface Lookup {
  type(name: string): TypeInfo | LinkInfo | undefined;
  /** The type an item outside the set has now, or null if there is no such item. */
  typeOf(id: Id): string | null;
  strict: boolean;
}

const isType = (t: TypeInfo | LinkInfo): t is TypeInfo => "statuses" in t;

/** Applies facts to a copy of the touched items, without judging conflicts: the store does that. */
export function after(now: Map<Id, Fields>, facts: readonly Fact[]): Map<Id, Fields | null> {
  const out = new Map<Id, Fields | null>();
  for (const [op, id, field, value] of facts) {
    const f = out.has(id) ? out.get(id) ?? {} : { ...(now.get(id) ?? {}) };
    if (op === "+") f[field] = value;
    else delete f[field];
    out.set(id, Object.keys(f).length ? f : null);
  }
  return out;
}

function kindFits(def: FieldDef, value: Json): string | null {
  switch (def.kind) {
    case "text":
      return typeof value === "string" ? null : "is text";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "is a number";
    case "boolean":
      return typeof value === "boolean" ? null : "is true or false";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : "is a date (ISO 8601)";
    case "json":
      return null;
    case "id":
      return typeof value === "string" && value !== "" ? null : "is an item's id";
    case "choice":
      return typeof value === "string" && (!def.values || def.values.includes(value)) ? null : `is one of ${(def.values ?? []).join(", ")}`;
    default:
      return null;
  }
}

export function check(now: Map<Id, Fields>, facts: readonly Fact[], look: Lookup): Problem[] {
  const next = after(now, facts);
  const asserted = new Map<Id, Set<string>>();
  for (const [op, id, field] of facts) if (op === "+") (asserted.get(id) ?? asserted.set(id, new Set()).get(id)!).add(field);
  const exists = (id: Id) => (next.has(id) ? next.get(id) !== null : look.typeOf(id) !== null);
  const typeAfter = (id: Id): string | null => {
    if (next.has(id)) {
      const f = next.get(id);
      return f && typeof f.type === "string" ? f.type : null;
    }
    return look.typeOf(id);
  };

  const problems: Problem[] = [];
  for (const [id, fields] of next) {
    if (!fields) continue;
    const said = asserted.get(id) ?? new Set<string>();
    const add = (code: string, message: string, field?: string) => problems.push({ code, message, id, ...(field ? { field } : {}) });
    if (typeof fields.type !== "string") {
      add("schema.type_missing", `${id} has fields but no type.`);
      continue;
    }
    const t = look.type(fields.type);
    if (!t) {
      if (look.strict) add("schema.type_unknown", `No pack defines the type ${fields.type}.`, "type");
      continue;
    }
    const whole = !now.has(id) || said.has("type");
    const toCheck = whole ? Object.keys(fields) : [...said].filter((f) => f in fields);
    const link = !isType(t);
    const defs: Record<string, FieldDef> = isType(t) ? t.fields : (t.fields ?? {});

    for (const field of toCheck) {
      if (field === "type") continue;
      if (field === "from" || field === "to") {
        if (!link) add("schema.not_a_link", `${t.name} is not a kind of link, so it has no ${field}.`, field);
        continue;
      }
      const def = defs[field];
      if (!def) {
        add("schema.field_unknown", `${t.name} has no field ${field}. Its fields: ${Object.keys(defs).join(", ") || "none"}.`, field);
        continue;
      }
      const value = fields[field]!;
      if (isType(t) && field === "status") {
        const all = [...t.statuses.open, ...t.statuses.closed];
        if (typeof value !== "string" || !all.includes(value)) add("schema.status", `${t.name}'s statuses are ${all.join(", ")}, not ${JSON.stringify(value)}.`, field);
        continue;
      }
      const wrong = kindFits(def, value);
      if (wrong) add("schema.field_kind", `${t.name}.${field} ${wrong}, not ${JSON.stringify(value)}.`, field);
      else if (def.kind === "id" && !exists(value as string)) add("schema.id_missing", `${t.name}.${field} names ${value}, which isn't on the graph.`, field);
    }

    if (link && (whole || said.has("from") || said.has("to"))) {
      for (const end of ["from", "to"] as const) {
        const at = fields[end];
        if (typeof at !== "string") {
          add("schema.link_end", `A ${t.name} link needs a ${end}.`, end);
          continue;
        }
        if (!exists(at)) {
          add("schema.link_end", `${t.name}'s ${end} is ${at}, which isn't on the graph.`, end);
          continue;
        }
        const allowed = (t as LinkInfo)[end];
        if (!allowed?.length) continue;
        const endType = typeAfter(at);
        const resolved = endType ? look.type(endType) : undefined;
        const base = resolved && isType(resolved) ? resolved.base : undefined;
        if (!base) {
          if (look.strict || resolved) add("schema.link_end", `${t.name}'s ${end} must be ${allowed.join(" or ")}; ${at} is ${endType ?? "untyped"}.`, end);
          continue;
        }
        if (!allowed.includes(base)) add("schema.link_end", `${t.name}'s ${end} must be ${allowed.join(" or ")}; ${at} is a ${base}.`, end);
      }
    }
  }
  return problems;
}
