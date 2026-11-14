// Saved views: every picture kept on the map, named, with what it is a picture of, so a person finds it without
// knowing which item it hangs on (docs/ui-strategy.md). A picture is a kept lens, named by its own title; the shape
// it is drawn in comes from the style or layout it names, else one kept about it. The kept first, then the newest. A working view lives as long as what it is about: once all of that has closed, it is retired with
// it, and left out (task e_gkv58kqb); so is one nobody has touched for WORKING_DAYS (the owner, 9 Nov 2026: views
// were piling up). Read through the lenses pack's context, as the asker; whether a view's query can be read at all is
// the query pack's (answer.flat_check).

import type { KernelContext } from '#pelago/kernel';
import { keptOf } from './query-kept.ts';
import { bringersIn, viewQuery } from './query-saved.ts';

/** How long a working view nobody keeps or changes stays among the views. */
const WORKING_DAYS = 14;

export interface Picture {
  /** The lens: the picture opens with it, from what it is of. */
  lens: string;
  /** Its name: the lens's own title. */
  title: string;
  /** The shape it is drawn in, when a style says. */
  shape?: string;
  /** What it is a picture of, or nothing for one of the whole map. */
  of?: { id: string; title: string; type: string };
  /** The project that is in or is, nearest first: what a person knows the picture by. */
  project?: { id: string; title: string };
  /** The document that brings it in: it is a part of that page, read there, and not one of the views a person picks from. */
  document?: { id: string; title: string };
  /** Why it cannot draw here, when it cannot: a term this map has no type for, a layout it names that is not on it. */
  cannot?: string;
  /** Its note's first line: what it shows. */
  note?: string;
  /** Its life: working (an agent's, until the owner keeps it) or kept (on the owner's word). */
  life: 'working' | 'kept';
  /** Asked for a person to pick from (`pick`): when it last changed, and what its query finds and walks, for its words. */
  updated_at?: string;
  filter?: unknown;
  walk?: unknown;
  /** One a pack ships (by its preset's id), not kept on the map: found by its name, opened by its query. */
  preset?: true;
}

/** A view a pack ships, as its pack file keeps it (packs/loader/kernel/declared.ts presetsOf). */
type Shipped = { id: string; title: string; type?: string; on?: unknown[]; description?: string; props?: Record<string, unknown> };

/** The views the packs ship that a person picks from: not one of an item's type (`on`, offered on its page), nor one the owner keeps a version of. */
function shipped(ctx: KernelContext, keptAs: Set<unknown>): Picture[] {
  const packs = (ctx.registry as unknown as { packs?: readonly { styles?: Shipped[] }[] }).packs ?? [];
  return packs
    .flatMap((p) => (p.styles ?? []).filter((v) => v.type === 'lens' && !(Array.isArray(v.on) && v.on.length) && !keptAs.has(v.id)))
    .map((v): Picture => ({ lens: v.id, title: v.title, life: 'kept', preset: true, ...(v.description && { note: v.description.split('\n')[0] }), filter: v.props?.filter ?? {}, walk: v.props?.walk ?? { over: [], steps: 0 } }));
}

type Row = { id: string; title: string; type: string; is_open: boolean; archived_at: unknown };

export async function savedViews(ctx: KernelContext, input: { limit?: number; pick?: boolean } = {}): Promise<{ pictures: Picture[]; more: number; ended?: string[] }> {
  const [all, styles] = await Promise.all([keptOf(ctx, 'lens', undefined, input.pick === true), keptOf(ctx, ['style', 'layout'], undefined)]);
  const ofIds = [...new Set(all.flatMap((x) => x.about))];
  const rows = ofIds.length ? ((await ctx.reads({ ids: ofIds })) as Row[]).filter((r) => r.archived_at == null) : [];
  const items = new Map(rows.map((r) => [r.id, r]));
  const lives = all.length ? ((await ctx.reads({ view_lives: { ids: all.map((x) => x.id), days: WORKING_DAYS } })) as { id: string; status: string; note: string | null; stale: boolean }[]) : [];
  const notes = new Map(lives.filter((r) => r.note).map((r) => [r.id, r.note!]));
  const kept = new Set(lives.filter((r) => r.status === 'kept').map((r) => r.id));
  const stale = new Set(lives.filter((r) => r.stale).map((r) => r.id));
  // A working view about items that have all closed (or gone) is retired with them, and one left untouched retires too.
  const ended = all.filter((x) => !kept.has(x.id) && (stale.has(x.id) || (x.about.length > 0 && x.about.every((id) => !items.get(id)?.is_open)))).map((x) => x.id);
  const lenses = all.filter((x) => !ended.includes(x.id));
  // The layouts the views name that the map has: one named and gone draws nothing.
  const asked = [...new Set(lenses.map((x) => (x.props.style as Record<string, unknown> | undefined)?.style).filter((s): s is string => typeof s === 'string'))];
  const there = asked.length ? ((await ctx.reads({ ids: asked })) as Row[]).filter((r) => r.archived_at == null) : [];
  const layouts = new Set(there.map((r) => r.id));
  const cannotOf = async (props: Record<string, unknown>): Promise<string | undefined> => {
    const style = (props.style as Record<string, unknown> | undefined)?.style;
    if (typeof style === 'string' && !layouts.has(style)) return `its layout ${style} is not on this map`;
    if (typeof props.view === 'string') return undefined;
    return (await ctx.call<Record<string, unknown>, { problem?: string }>('answer.flat_check', viewQuery(props))).problem;
  };
  const cannot = new Map(await Promise.all(lenses.map(async (x) => [x.id, await cannotOf(x.props)] as const)));
  const projectOf = await projects(ctx, ofIds);
  const held = lenses.length ? ((await ctx.reads({ mentioned: { to: lenses.map((x) => x.id), types: bringersIn(ctx), order: 'id' } })) as { to: string; id: string; title: string }[]) : [];
  const documents = new Map(held.map((r) => [r.to, { id: r.id, title: r.title }]));
  // keptOf answers oldest first; saved views read newest first, the kept above the rest.
  const pictures = lenses
    .reverse()
    .map((x): Picture => {
      // The style the view names itself, as the page draws it, else one kept about it.
      const own = (x.props.style ?? {}) as Record<string, unknown>;
      const named = styles.find((s) => s.id === own.style);
      const style = named ?? styles.find((s) => s.about.includes(x.id));
      const found = x.about.map((id) => items.get(id)).find(Boolean);
      const of = found && { id: found.id, title: found.title, type: found.type };
      // A style it names lies over its own settings, and a layout with code draws no shape.
      const shape = named ? (typeof named.props.code === 'string' || (named.props.code && typeof named.props.code === 'object') ? undefined : (named.props.shape ?? own.shape)) : (own.shape ?? style?.props.shape);
      const document = documents.get(x.id);
      const why = cannot.get(x.id);
      return { lens: x.id, title: x.title, ...(typeof shape === 'string' && { shape }), ...(of && { of }), ...(of && projectOf(of.id) && { project: projectOf(of.id) }), ...(document && { document }), ...(notes.has(x.id) && { note: notes.get(x.id) }), ...(why && { cannot: why }), life: kept.has(x.id) ? 'kept' : 'working', ...(input.pick === true && { updated_at: x.updated_at, filter: x.props.filter ?? {}, walk: x.props.walk ?? { over: [], steps: 0 } }) };
    })
    .sort((a, b) => Number(b.life === 'kept') - Number(a.life === 'kept'));
  // A person picking also finds what the packs ship, by its name, after what is kept on the map.
  if (input.pick === true) pictures.push(...shipped(ctx, new Set(lenses.map((x) => x.props.preset).filter(Boolean))));
  const limit = input.limit ?? 100;
  return { pictures: pictures.slice(0, limit), more: Math.max(0, pictures.length - limit), ...(ended.length && { ended }) };
}

/**
 * The nearest project each of some items is or is part of, going up "is part of" (the part_of closure): a project is
 * a type the packs put at that altitude, and the nearest is the one the others hold too.
 */
async function projects(ctx: KernelContext, ids: string[]): Promise<(id: string) => { id: string; title: string } | undefined> {
  const kinds = [...ctx.registry.types.values()].filter((t) => (t as { altitude?: string }).altitude === 'project').map((t) => t.id);
  const rows = ids.length ? ((await ctx.reads({ in_projects: { ids, types: kinds } })) as { id: string; project: string; title: string; above: number }[]) : [];
  const nearest = new Map<string, { id: string; title: string; above: number }>();
  for (const r of rows) if (r.id === r.project || (nearest.get(r.id)?.id !== r.id && r.above > (nearest.get(r.id)?.above ?? -1))) nearest.set(r.id, { id: r.project, title: r.title, above: r.id === r.project ? Infinity : r.above });
  return (id) => {
    const found = nearest.get(id);
    return found && { id: found.id, title: found.title };
  };
}
