// What the map keeps for looking at it: kept views (lens items), styles and layouts, with what each is about; the hubs that need views of
// their own; and where a lens or a style is seen at work. Read through the pack's context (docs/kernel-packs.md, "Moving a service in
// the wave"): every read under the asker's row-level security, as the kernel's SQL read it.

import type { KernelContext } from '#pelago/kernel';

export interface Kept {
  id: string;
  /** Its type: a layout's fields draw as its code and settings (src/styles.ts). Left out, a style or a view. */
  type?: string;
  title: string;
  props: Record<string, unknown>;
  about: string[];
}

type Looks = 'lens' | 'style' | 'layout';
type Row = { id: string; type: string; title: string; is_open: boolean; updated_at: Date | string; archived_at: Date | string | null; props?: Record<string, unknown> };
type Link = { from_id: string; to_id: string };

const time = (t: Date | string) => new Date(t).getTime();

/** Every item of a type and its flavours that is not archived, a page at a time until the last (the items read). */
export async function everyItem(ctx: KernelContext, type: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let after: string | undefined, first = true; first || after; first = false) {
    const page = (await ctx.reads({ items: { type }, page: after ? { after } : {} })) as { rows: Row[]; next?: string };
    out.push(...page.rows);
    after = page.next;
  }
  return out;
}

/** Every lens, style or layout (of the types given) kept on the map, with what each is about; and one named outright, retired or not. */
export async function keptOf(ctx: KernelContext, type: Looks | Looks[], named: unknown): Promise<Kept[]> {
  const asked = Array.isArray(type) ? type : [type];
  const types = new Set(asked.flatMap((t) => ctx.registry.family(t)));
  // Each type's items once (a family may hold another's), oldest change first, then by id.
  const seen = new Set<string>();
  const all = (await Promise.all(asked.map((t) => everyItem(ctx, t)))).flat().filter((r) => types.has(r.type) && !seen.has(r.id) && (seen.add(r.id), true));
  const rows = all
    .filter((r) => r.is_open || (typeof named === 'string' && r.id === named))
    .sort((a, b) => time(a.updated_at) - time(b.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({ id: r.id, type: r.type, title: r.title, props: r.props ?? {} }));
  // One archived is left out, and what named it falls back; only a name never kept is refused.
  if (typeof named === 'string' && !rows.some((r) => r.id === named) && !((await ctx.reads({ ids: [named] })) as unknown[]).length) throw new Error(`No ${asked.join(' or ')} "${named}"`);
  const links = rows.length ? ((await ctx.reads({ links: { from: rows.map((r) => r.id), types: ['about'] } })) as Link[]) : [];
  return rows.map((r) => ({ ...r, about: links.filter((link) => link.from_id === r.id).map((link) => link.to_id) }));
}

/** How many open things an item holds before it is a hub, unless its project says otherwise (hub_at). */
export const HUB_AT = 12;

/** Whether an item of this type is the kernel's own (src/head.ts, isKernel). */
const isKernel = (ctx: KernelContext, type: string) => (ctx.registry.types.get(type) as { system?: boolean } | undefined)?.system === true;

/**
 * The hubs within an item or a place: open items in it that hold enough to need views of their own. How much is
 * enough is the nearest project's hub_at, or HUB_AT: a project still being shaped sets it low, so that most of what
 * is in it is treated as a hub. Read off what is in it each time (what is open and not the system's, and what is
 * part of what); nothing says an item is a hub that could go stale. Across the whole map it is not read: it would
 * read every item.
 */
export async function hubs(ctx: KernelContext, within?: string) {
  if (!within) throw new Error('hubs reads within an item or a place (within): across the whole map it would read every item.');
  const scope = (await ctx.reads({ within: { id: within, open: true } })) as string[];
  const read = scope.length ? ((await ctx.reads({ ids: scope })) as Row[]).filter((e) => e.archived_at === null || e.archived_at === undefined) : [];
  const parts = scope.length ? ((await ctx.reads({ links: { among: scope, types: ['part_of'], order: 'id' } })) as Link[]) : [];
  const above = await hubAtAbove(ctx, within);
  const byId = new Map(read.filter((e) => e.is_open && !isKernel(ctx, e.type)).map((e) => [e.id, { ...e, props: e.props ?? {} }]));
  const up = new Map<string, string>();
  const kids = new Map<string, string[]>();
  for (const p of parts) {
    if (!byId.has(p.from_id) || !byId.has(p.to_id) || up.has(p.from_id) || p.from_id === p.to_id) continue;
    up.set(p.from_id, p.to_id);
    kids.set(p.to_id, [...(kids.get(p.to_id) ?? []), p.from_id]);
  }
  const counts = new Map<string, number>();
  const inside = (id: string, trail = new Set<string>()): number => {
    const known = counts.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0; // a loop of belonging: stop going round
    trail.add(id);
    const n = (kids.get(id) ?? []).reduce((sum, kid) => sum + 1 + inside(kid, trail), 0);
    trail.delete(id);
    counts.set(id, n);
    return n;
  };
  const at = (id: string): number => {
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = up.get(cur), steps++) {
      const e = byId.get(cur)!;
      if (typeof e.props.hub_at === 'number') return e.props.hub_at;
    }
    return above;
  };
  const views = new Map<string, number>();
  for (const lens of await keptOf(ctx, 'lens', undefined)) for (const id of lens.about) views.set(id, (views.get(id) ?? 0) + 1);
  return [...byId.values()]
    .map((e) => ({ id: e.id, type: e.type, title: e.title, inside: inside(e.id), at: at(e.id), views: views.get(e.id) ?? 0 }))
    .filter((h) => h.inside > 0 && h.inside >= h.at)
    .sort((a, b) => b.inside - a.inside || a.title.localeCompare(b.title));
}

/**
 * The hub_at of the nearest item an item is part of (itself included) that says one; else HUB_AT. What it is part of
 * is read from the part_of closure (the ancestors read: what is kept, not archived and not the system's), and the
 * nearest is the deepest: the one with the most above it.
 */
async function hubAtAbove(ctx: KernelContext, id: string): Promise<number> {
  const ancestors = (await ctx.reads({ ancestors: [id] })) as { id: string; at: string; depth: number }[];
  const depth = new Map<string, number>([[id, ancestors.length], ...ancestors.map((a): [string, number] => [a.at, a.depth])]);
  const items = (await ctx.reads({ ids: [...depth.keys()] })) as Row[];
  const said = items
    .filter((e) => typeof e.props?.hub_at === 'number')
    .sort((a, b) => depth.get(b.id)! - depth.get(a.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return said.length ? Number(said[0].props!.hub_at) : HUB_AT;
}

/** Where on the page a kept view, a style or a layout is seen at work: the view itself, or the picture of what a style or layout is about, or of the whole map. Nothing for any other item. */
export async function pictureOf(ctx: KernelContext, id: string): Promise<string | undefined> {
  const [item] = (await ctx.reads({ ids: [id] })) as Row[];
  if (item && ctx.registry.isA(item.type, 'lens')) return `v?canvas=${id}`;
  if (!item || !(ctx.registry.isA(item.type, 'style') || ctx.registry.isA(item.type, 'layout'))) return undefined;
  const [about] = (await ctx.reads({ links: { from: [id], types: ['about'], order: 'id', limit: 1 } })) as Link[];
  return about ? `graph?from=${about.to_id}` : 'graph?lens';
}

/** answer.picture_of: where on the page an item is seen at work (pictureOf), for the tool surface's change. */
export const pictureOfAnswer = async (ctx: KernelContext, input: { id: string }) => ({ hash: await pictureOf(ctx, String(input?.id)) });
