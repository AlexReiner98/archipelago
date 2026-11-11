// The type table: every type and relation the workspace has used, kept in its database. When a workspace opens,
// what the packs define now is written there as active; what is there and no pack defines any more turns dormant,
// and the registry takes it back in, so the items of a removed pack keep their starter, statuses, fields and
// capabilities. A definition that changed (a pack upgraded, or added back after a while) is logged with what changed.
// A type that took another over (moved_from) takes its items once the old one is defined by no pack; a relation, its links.

import { Archipelago } from './pelago.ts';
import type { ResolvedRelation, ResolvedType } from './packs.ts';
import { moveQueries, termQueries } from './query-saved.ts';
import { moveStyles } from './style-move.ts';
import { moveLayouts } from './layout-move.ts';
import { moveLives, movePins } from './view-life.ts';
import { linkOwners } from './owner-link.ts';
import { newId } from './db.ts';
import { versionAdded } from './version-types.ts';

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

/**
 * The migrations a workspace runs when it opens, each once (bug e_kdt2upeg): the names of those done, kept as a setting
 * of the workspace, and the takeovers last moved. A restored backup brings its own (none, if it is older than this);
 * a merge takes it off (movesAgain), since what it brings may be from before them.
 */
const MOVES = 'moves_done';
interface Moves {
  done: string[];
  taken?: string;
}

/** Have the migrations asked again on the next sync: what a merge brought in may be in the shapes from before them. */
export async function movesAgain(l: Archipelago): Promise<void> {
  await wholeMap(l).db.query(`delete from setting where key = $1`, [MOVES]);
}

/** The map whole: the type table is the system's own, kept as the server keeps it whoever's act changed the types. */
const wholeMap = (l: Archipelago) => (l.db.whole ? new Archipelago(l.db.whole, l.registry, l.policy, l.workspace) : l);

/** Bring the table in line with the packs, and the registry in line with the table. Returns what it changed. */
export async function syncTypes(given: Archipelago): Promise<{ activated: string[]; dormant: string[]; changed: Record<string, string[]>; moved: Record<string, number> }> {
  const l = wholeMap(given);
  const reg = l.registry;
  const { rows } = await l.db.query<Row>(`select id, what, pack, state, def from type_def`);
  const kept = new Map(rows.map((r) => [r.id, r]));
  const live: Row[] = [
    // Stored with `kind`, its starter: what the database fills an item's kind column from (src/head.ts, ITEM_KIND).
    ...[...reg.types.values()].filter((t) => !t.dormant).map((def) => ({ id: def.id, what: 'type' as const, pack: def.pack, state: 'active' as const, def: { ...def, kind: def.starter } })),
    ...[...reg.relations.values()].filter((r) => !r.dormant).map((def) => ({ id: def.id, what: 'relation' as const, pack: def.pack, state: 'active' as const, def })),
  ];
  // What a version of a pack adds is kept dormant, so its items keep their type once the version is archived.
  const added = versionAdded(reg);
  const asleepNow: Row[] = [
    ...[...added.types].map((id) => reg.types.get(id)!).map((def) => ({ id: def.id, what: 'type' as const, pack: def.pack, state: 'dormant' as const, def: { ...def, kind: def.starter } })),
    ...[...added.relations].map((id) => reg.relations.get(id)!).map((def) => ({ id: def.id, what: 'relation' as const, pack: def.pack, state: 'dormant' as const, def })),
  ].filter((r) => { const was = kept.get(r.id); return !was || (was.state === 'dormant' && canonical(was.def) !== canonical(r.def)); });
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
    for (const row of asleepNow)
      await tx.query(
        `insert into type_def (id, what, pack, state, def) values ($1, $2, $3, 'dormant', $4::jsonb)
         on conflict (id) do update set what = $2, pack = $3, def = $4::jsonb, changed = now() where type_def.state = 'dormant'`,
        [row.id, row.what, row.pack, JSON.stringify(row.def)],
      );
    if (dormant.length) await tx.query(`update type_def set state = 'dormant', changed = now() where id = any($1::text[])`, [dormant]);
  });
  const stamp: Moves = (await l.setting<Moves>(MOVES)) ?? { done: [] };
  const was = JSON.stringify(stamp);
  const once = async (name: string, ready: boolean, run: () => Promise<unknown>) => {
    if (!ready || stamp.done.includes(name)) return;
    await run();
    stamp.done.push(name);
  };
  const has = (...types: string[]) => types.every((t) => reg.types.has(t));
  await once('terms', has('lens'), () => termQueries(l)); // views kept in the filter's old words, said in its terms
  // A type a pack took over brings its items with it, once no pack defines the old one: asked again only when which
  // types are taken over and gone changes, or when the type table did.
  const typesChanged = !rows.length || dormant.length > 0 || activated.length > 0 || Object.keys(changed).length > 0;
  const takeovers = [
    ...[...reg.types.values()].flatMap((t) => (t.dormant ? [] : (t.movedFrom ?? []).filter((old) => !now.has(old)).map((old) => ({ old, to: t.id, what: 'entity' as const, statuses: t.movedStatuses?.[old] })))),
    ...[...reg.relations.values()].flatMap((r) => (r.dormant ? [] : (r.moved_from ?? []).filter((old) => !now.has(old)).map((old) => ({ old, to: r.id, what: 'relation' as const, statuses: undefined })))),
  ];
  const taken = takeovers.map((t) => `${t.old}>${t.to}`).sort().join(' ');
  const moved: Record<string, number> = {};
  if (typesChanged || stamp.taken !== taken) {
    for (const t of takeovers) if ((moved[t.old] = await l.retype(t.old, t.to, t.what, t.statuses)) === 0) delete moved[t.old];
    stamp.taken = taken;
  }
  // Each item's kind in its row, now the type table is whole: again whenever the types changed or items moved.
  if (typesChanged || Object.keys(moved).length) stamp.done = stamp.done.filter((d) => d !== 'kinds');
  await once('kinds', true, () => l.fillKinds());
  await once('queries', has('lens'), () => moveQueries(l)); // views kept before the flat lens, translated into flat lenses
  await once('styles', has('style', 'lens'), () => moveStyles(l)); // styles made for one view, moved into it
  await once('layouts', has('style', 'layout'), () => moveLayouts(l)); // styles with code, layouts now (after styles, which reads code on a style)
  await once('lives', has('lens', 'layout'), () => moveLives(l)); // views and layouts sorted into working, kept and retired (after layouts)
  await once('pins', has('lens'), () => movePins(l)); // the ids a view held by hand, id terms of its filter (after lives, which reads pinned)
  await once('owners', true, () => linkOwners(l, () => newId('r'))); // each owner said as a link
  if (JSON.stringify(stamp) !== was) await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [MOVES, JSON.stringify(stamp)]);
  const asleep = [...rows.filter((r) => !now.has(r.id) && !asleepNow.some((a) => a.id === r.id)), ...asleepNow];
  reg.keep({
    types: asleep.filter((r) => r.what === 'type').map((r) => r.def as ResolvedType),
    relations: asleep.filter((r) => r.what === 'relation').map((r) => r.def as ResolvedRelation),
  });
  return { activated, dormant, changed, moved };
}
