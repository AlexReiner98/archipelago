// What the schema tool gives an agent unless it asks for more: each type and
// relation on a line, enough to write a change. The whole description (every
// field's note, the screens, the verbs) is a type or a pack away, or full.

import type { FieldDef, Registry } from './packs.ts';

const field = (name: string, f: FieldDef) =>
  f.type === 'enum' && f.values ? `${name}: ${f.values.join('|')}` : f.type === 'string' ? name : `${name}: ${f.type}`;

/** Each type's statuses and the fields an author sets, and each relation's ends. */
export function schemaBrief(registry: Registry) {
  const types = [...registry.types.values()].filter((t) => !t.dormant);
  const relations = [...registry.relations.values()].filter((r) => !r.dormant);
  return {
    packs: registry.packs.map((p) => p.id),
    types: types.map((t) => ({
      id: t.id,
      kind: t.kind ?? 'system',
      statuses: `${t.statuses.open.join(' ')} / ${t.statuses.closed.join(' ')}`,
      fields: Object.entries(t.fields).filter(([, f]) => !f.system).map(([name, f]) => field(name, f)).join('; ') || undefined,
    })),
    relations: Object.fromEntries(relations.map((r) => [r.id, `${r.from.join(' ')} -> ${r.to.join(' ')}`])),
    common_fields: 'title (60 characters at most), body, status, owner, visibility (private or shared), confidence (0 to 1)',
    more: 'Statuses read open / closed. For what a type or relation is for and what each field means, call again with type (a type, a relation or a pack); full: true for everything.',
  };
}

/** One type, relation or pack whole, as the full description has it. */
export function schemaOf<T extends { types: { id: string; pack: string }[]; relations: { id: string; pack: string }[] }>(described: T, name: string) {
  // A type or relation by that name comes first: "work" is a kind before it is a pack.
  const named = (x: { id: string }) => x.id === name;
  const byId = described.types.some(named) || described.relations.some(named);
  const match = byId ? named : (x: { pack: string }) => x.pack === name;
  const types = described.types.filter(match);
  const relations = described.relations.filter(match);
  if (!types.length && !relations.length) throw new Error(`No type, relation or pack is called "${name}".`);
  return { types, relations };
}
