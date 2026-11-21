/**
 * What a Packs view card shows, worked out from a pack's reference: pure,
 * so it is tested without a page.
 */
import type { Json } from "../../spec/common.ts";
import type { PackDoc } from "./read.ts";

export interface Field {
  name: string;
  type: string;
  required: boolean;
  doc?: string;
}

/** An action's input, field by field, from its JSON Schema. */
export function fieldsOf(schema: Json | undefined): Field[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const props = schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(props).map(([name, p]) => {
    const o = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    const type = Array.isArray(o.enum)
      ? o.enum.map((v) => JSON.stringify(v)).join(" | ")
      : typeof o.type === "string"
        ? o.type === "array" && o.items && typeof o.items === "object" && !Array.isArray(o.items) && typeof o.items.type === "string"
          ? `${o.items.type}[]`
          : o.type
        : Array.isArray(o.type)
          ? o.type.join(" | ")
          : "any";
    return { name, type, required: required.has(name), ...(typeof o.description === "string" ? { doc: o.description } : {}) };
  });
}

/** Whether a pack's card matches what is typed in the filter: its id, a key, an action, a place or a slot. */
export function matches(doc: PackDoc, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [
    doc.id,
    doc.side,
    doc.state,
    ...doc.provides.map((k) => `${k.key} ${k.contract ?? ""}`),
    ...doc.inject.map((k) => k.key),
    ...doc.actions.map((a) => `${a.name} ${a.title}`),
    ...doc.places.map((p) => p.place),
    ...(doc.slots ? [...doc.slots.declares.map((s) => s.name), ...doc.slots.fills.map((f) => f.slot)] : []),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The spec contracts a pack implements: those of the keys it provides, with the editions. */
export function contractsOf(doc: PackDoc): { contract: string; keys: string[] }[] {
  const by = new Map<string, string[]>();
  for (const k of doc.provides) if (k.contract) by.set(k.contract, [...(by.get(k.contract) ?? []), k.key]);
  return [...by].map(([contract, keys]) => ({ contract, keys }));
}

/** A count of a pack's registrations, for its card's line. */
export function tally(doc: PackDoc): string {
  const n = (x: number, one: string, many = `${one}s`) => (x ? `${x} ${x === 1 ? one : many}` : "");
  const nodes = doc.places.reduce((s, p) => s + p.nodes, 0);
  return [
    n(doc.provides.length, "key"),
    n(doc.actions.length, "action"),
    nodes ? `${n(nodes, "node")} at ${n(doc.places.length, "place")}` : "",
    n((doc.slots?.declares.length ?? 0) + (doc.slots?.fills.length ?? 0), "slot"),
  ]
    .filter(Boolean)
    .join(" · ");
}
