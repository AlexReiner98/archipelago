// The schema's words, as a part is handed them (decision e_fx62gsjb: data in, marks out). A part runs walled in a
// worker and has no schema to look a type up in, so the page hands it the words of the registry the island it draws
// for runs (its pinned version's): each type's title, what it is a flavour of, its open and closed statuses, and each
// link type's title. Only words: no field shape, no rule, nothing that is a type's machinery.

import { createHash } from 'node:crypto';
import type { Registry } from './packs.ts';

/** A type as a part reads it: its title, the type it is a flavour of (none for a starter), its statuses. */
export interface TypeWords {
  title: string;
  of?: string;
  open: string[];
  closed: string[];
}
/** The words of one registry, with their hash, so a page that holds them is not sent them again. */
export interface Words {
  hash: string;
  types: Record<string, TypeWords>;
  links: Record<string, string>;
}

/** The words of `reg`: the types and link types an item may be or be tied by, not those kept from a pack that is gone. */
export function wordsOf(reg: Pick<Registry, 'types' | 'relations'>): Words {
  const types: Record<string, TypeWords> = {};
  for (const t of [...reg.types.values()].filter((t) => !t.dormant).sort((a, b) => a.id.localeCompare(b.id)))
    types[t.id] = { title: t.title, ...(t.lineage[1] && { of: t.lineage[1] }), open: [...t.statuses.open], closed: [...t.statuses.closed] };
  const links: Record<string, string> = {};
  for (const r of [...reg.relations.values()].filter((r) => !r.dormant).sort((a, b) => a.id.localeCompare(b.id))) links[r.id] = r.title;
  const hash = createHash('sha256').update(JSON.stringify({ types, links })).digest('hex');
  return { hash, types, links };
}

/** A field as a root pack's part that reads items whole is told of it: its shape, never its value. */
export interface FieldWords {
  type: string;
  values?: string[];
  code?: true;
  /** Code that may be files by path (layout.code): the sheet tries it whole, the file written beside the others. */
  files?: true;
  /** Code that is a stylesheet: the sheet colours it as CSS and never tries it on the canvas. */
  css?: true;
  system?: true;
  description?: string;
}
/** The schema's fields and capabilities, by type, with their hash: handed only to a root pack's part that reads items whole (`reads: "*"`). */
export interface SchemaWords {
  hash: string;
  types: Record<string, { fields: Record<string, FieldWords>; capabilities: Record<string, unknown> }>;
}

/**
 * The fields and capabilities of `reg`'s types, for the sheet's parts (a root pack's, which keep the human in control as
 * its page did): what each field takes, so the page can be drawn and edited from data. Never sent to a map pack's part.
 */
export function schemaOf(reg: Pick<Registry, 'types'>): SchemaWords {
  const types: SchemaWords['types'] = {};
  for (const t of [...reg.types.values()].filter((t) => !t.dormant).sort((a, b) => a.id.localeCompare(b.id))) {
    const fields: Record<string, FieldWords> = {};
    for (const [name, f] of Object.entries({ ...t.columns, ...t.fields })) {
      if (!f) continue;
      fields[name] = { type: String(f.type), ...(f.values && { values: [...f.values] }), ...(f.code && { code: true as const }), ...(f.files && { files: true as const }), ...(f.css && { css: true as const }), ...(f.system && { system: true as const }), ...(f.description && { description: f.description }) };
    }
    types[t.id] = { fields, capabilities: JSON.parse(JSON.stringify(t.capabilities ?? {})) };
  }
  const hash = createHash('sha256').update(JSON.stringify(types)).digest('hex');
  return { hash, types };
}
