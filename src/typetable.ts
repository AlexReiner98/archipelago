// The type table: every type and relation the workspace has used, kept in its database. When a workspace opens,
// what the packs define now is written there as active; what is there and no pack defines any more turns dormant,
// and the registry takes it back in, so the items of a removed pack keep their kind, statuses, fields and
// capabilities. A definition that changed (a pack upgraded, or added back after a while) is logged with what changed.
// A type that took another over (moved_from) takes its items once the old one is defined by no pack; a relation, its links.

import type { Archipelago } from './pelago.ts';
import type { ResolvedRelation, ResolvedType } from './packs.ts';
import { movePlaces } from './canvas-places.ts';
import { moveLenses } from './lens-saved.ts';

interface Row {
  id: string;
  what: 'type' | 'relation';
  pack: string;
  state: 'active' | 'dormant';
  def: ResolvedType | ResolvedRelation;
}

/** JSON with its keys in order, so a definition read back from jsonb compares equal to the one written. */
const canonical = (x: unknown): string =>
  Array.isArray(x)
    ? `[${x.map(canonical).join(',')}]`
    : x && typeof x === 'object'
      ? `{${Object.keys(x)
          .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(x ?? null);

/** What changed between two definitions of a type or relation, in a few words each. */
export function differences(was: Record<string, unknown>, now: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = (x: unknown) => Object.keys((x as Record<string, unknown> | undefined) ?? {});
  const gone = (a: string[], b: string[]) => a.filter((k) => !b.includes(k));
  for (const f of gone(keys(now.fields), keys(was.fields))) out.push(`field ${f} added`);
  for (const f of gone(keys(was.fields), keys(now.fields))) out.push(`field ${f} removed`);
  const statuses = (x: unknown) => {
    const s = x as { open?: string[]; closed?: string[] } | undefined;
    return [...(s?.open ?? []), ...(s?.closed ?? [])];
  };
  for (const s of gone(statuses(now.statuses), statuses(was.statuses))) out.push(`status ${s} added`);
  for (const s of gone(statuses(was.statuses), statuses(now.statuses))) out.push(`status ${s} removed`);
  for (const key of ['kind', 'root', 'extends', 'capabilities', 'from', 'to'])
    if (JSON.stringify(was[key] ?? null) !== JSON.stringify(now[key] ?? null)) out.push(`${key} changed`);
  return out;
}

/** Bring the table in line with the packs, and the registry in line with the table. Returns what it changed. */
export async function syncTypes(l: Archipelago): Promise<{ activated: string[]; dormant: string[]; changed: Record<string, string[]>; moved: Record<string, number> }> {
  const reg = l.registry;
  const { rows } = await l.db.query<Row>(`select id, what, pack, state, def from type_def`);
  const kept = new Map(rows.map((r) => [r.id, r]));
  const live: Row[] = [
    ...[...reg.types.values()].filter((t) => !t.dormant).map((def) => ({ id: def.id, what: 'type' as const, pack: def.pack, state: 'active' as const, def })),
    ...[...reg.relations.values()].filter((r) => !r.dormant).map((def) => ({ id: def.id, what: 'relation' as const, pack: def.pack, state: 'active' as const, def })),
  ];
  const now = new Set(live.map((r) => r.id));
  const dormant = rows.filter((r) => r.state === 'active' && !now.has(r.id)).map((r) => r.id);
  const activated: string[] = [];
  const changed: Record<string, string[]> = {};
  await l.db.transaction(async (tx) => {
    for (const row of live) {
      const was = kept.get(row.id);
      if (was && was.state === 'active' && canonical(was.def) === canonical(row.def)) continue;
      if (was?.state === 'dormant') activated.push(row.id);
      if (was) {
        const diff = differences(was.def as unknown as Record<string, unknown>, row.def as unknown as Record<string, unknown>);
        if (diff.length) changed[row.id] = diff;
      }
      await tx.query(
        `insert into type_def (id, what, pack, state, def) values ($1, $2, $3, 'active', $4::jsonb)
         on conflict (id) do update set what = $2, pack = $3, state = 'active', def = $4::jsonb, changed = now()`,
        [row.id, row.what, row.pack, JSON.stringify(row.def)],
      );
    }
    if (dormant.length) await tx.query(`update type_def set state = 'dormant', changed = now() where id = any($1::text[])`, [dormant]);
    if (dormant.length || activated.length || Object.keys(changed).length)
      await l.log(tx, { actor: 'system', action: 'types.sync', reason: 'The packs loaded differ from the types the workspace kept.', detail: { dormant, activated, changed } });
  });
  // A type a pack took over brings its items with it, once no pack defines the old one (a migration, run once).
  const moved: Record<string, number> = {};
  for (const t of reg.types.values()) for (const old of t.dormant ? [] : (t.movedFrom ?? [])) if (!now.has(old) && (moved[old] = await l.retype(old, t.id)) === 0) delete moved[old];
  for (const r of reg.relations.values()) for (const old of r.dormant ? [] : (r.moved_from ?? [])) if (!now.has(old) && (moved[old] = await l.retype(old, r.id, 'relation')) === 0) delete moved[old];
  await l.fillKinds(); // each item's kind in its row, now the type table is whole
  await movePlaces(l); // places a style kept, moved into their stream (a migration, run once)
  await moveLenses(l); // views kept before the flat lens, translated into flat lenses (a migration, run once)
  const asleep = rows.filter((r) => !now.has(r.id));
  reg.keep({
    types: asleep.filter((r) => r.what === 'type').map((r) => r.def as ResolvedType),
    relations: asleep.filter((r) => r.what === 'relation').map((r) => r.def as ResolvedRelation),
  });
  return { activated, dormant, changed, moved };
}
